<?php
declare(strict_types=1);

/**
 * stats.php: server metrics for the Server tab.
 * - Works on Linux (shared hosting, VPS, containers, Raspberry Pi) and Windows.
 * - Tries several ways to read RAM; if all fail it says WHY in "warnings".
 * - Saves a sample at most once a minute (no cron needed, the dashboard polling
 *   triggers it) and returns the last N hours for charts.
 *
 * Usage: stats.php            -> current values + last 6 hours of history
 *        stats.php?hours=24   -> history range (1 to 24)
 */

require __DIR__ . '/auth.php';
require_login(true);

header('Content-Type: application/json');
header('Cache-Control: no-store');

const SAMPLE_EVERY = 60;     // seconds between saved samples
const KEEP_SAMPLES = 1440;   // 24 hours at 1 per minute

/* ---------- small helpers ---------- */

function rd(string $path): ?string {
    $s = @file_get_contents($path);
    return $s === false ? null : $s;
}

function can_exec(): bool {
    if (!function_exists('shell_exec')) return false;
    $off = array_map('trim', explode(',', (string)ini_get('disable_functions')));
    return !in_array('shell_exec', $off, true);
}

function sh(string $cmd): ?string {
    if (!can_exec()) return null;
    $win = PHP_OS_FAMILY === 'Windows';
    $out = @shell_exec($win ? $cmd : $cmd . ' 2>/dev/null');
    return (is_string($out) && trim($out) !== '') ? $out : null;
}

function pct(float $part, float $whole): float {
    return $whole > 0 ? round($part / $whole * 100, 1) : 0.0;
}

/* ---------- memory: several fallbacks ---------- */

function cgroup_mem(): ?array {
    // cgroup v2
    $max = rd('/sys/fs/cgroup/memory.max');
    $cur = rd('/sys/fs/cgroup/memory.current');
    if ($max !== null && $cur !== null && ctype_digit(trim($max))) {
        $used = (int)trim($cur);
        $st = rd('/sys/fs/cgroup/memory.stat');
        if ($st !== null && preg_match('/^inactive_file (\d+)/m', $st, $x)) $used -= (int)$x[1];
        return ['total' => (int)trim($max), 'used' => max(0, $used)];
    }
    // cgroup v1
    $max = rd('/sys/fs/cgroup/memory/memory.limit_in_bytes');
    $cur = rd('/sys/fs/cgroup/memory/memory.usage_in_bytes');
    if ($max !== null && $cur !== null && (int)trim($max) > 0 && (int)trim($max) < (1 << 60)) {
        return ['total' => (int)trim($max), 'used' => (int)trim($cur)];
    }
    return null;
}

function read_memory(array &$warn): ?array {
    $total = $avail = $cached = $swapT = $swapF = 0;
    $source = null;

    // 1) Linux: /proc/meminfo
    $m = rd('/proc/meminfo');
    if ($m !== null && preg_match_all('/^(\w+):\s+(\d+)\s*kB/m', $m, $mm)) {
        $k = array_combine($mm[1], array_map(fn($v) => (int)$v * 1024, $mm[2]));
        $total  = $k['MemTotal'] ?? 0;
        $avail  = $k['MemAvailable'] ?? (($k['MemFree'] ?? 0) + ($k['Buffers'] ?? 0) + ($k['Cached'] ?? 0));
        $cached = ($k['Cached'] ?? 0) + ($k['Buffers'] ?? 0);
        $swapT  = $k['SwapTotal'] ?? 0;
        $swapF  = $k['SwapFree'] ?? 0;
        $source = 'proc';
    }

    // 2) Linux: `free -b`
    if ($source === null && ($f = sh('free -b')) !== null
        && preg_match('/^Mem:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*(\d+)?/m', $f, $x)) {
        $total  = (int)$x[1];
        $avail  = isset($x[6]) && $x[6] !== '' ? (int)$x[6] : (int)$x[3];
        $cached = (int)$x[5];
        if (preg_match('/^Swap:\s+(\d+)\s+\d+\s+(\d+)/m', $f, $s)) { $swapT = (int)$s[1]; $swapF = (int)$s[2]; }
        $source = 'free';
    }

    // 3) Windows: PowerShell / WMIC
    if ($source === null && PHP_OS_FAMILY === 'Windows') {
        $j = sh('powershell -NoProfile -Command "Get-CimInstance Win32_OperatingSystem | Select-Object TotalVisibleMemorySize,FreePhysicalMemory | ConvertTo-Json"');
        $d = $j ? json_decode($j, true) : null;
        if (is_array($d) && isset($d['TotalVisibleMemorySize'], $d['FreePhysicalMemory'])) {
            $total = (int)$d['TotalVisibleMemorySize'] * 1024;
            $avail = (int)$d['FreePhysicalMemory'] * 1024;
            $source = 'windows';
        }
    }

    if ($source === null) {
        $warn[] = 'RAM could not be read. OS: ' . PHP_OS_FAMILY
            . '; open_basedir: ' . (ini_get('open_basedir') ?: 'none')
            . '; shell_exec ' . (can_exec() ? 'allowed' : 'disabled')
            . '. In Plesk (Websites & Domains > PHP Settings) add /proc:/sys to open_basedir or set it to none.';
        return null;
    }

    $used = max(0, $total - $avail);

    // Inside a container/VPS the limit is smaller than the host RAM: prefer the cgroup numbers
    $cg = cgroup_mem();
    if ($cg !== null && $cg['total'] > 0 && ($total === 0 || $cg['total'] < $total * 0.98)) {
        $total  = $cg['total'];
        $used   = min($cg['used'], $total);
        $avail  = $total - $used;
        $source = 'cgroup';
    }

    return [
        'source'    => $source,
        'total'     => $total,
        'used'      => $used,
        'available' => $avail,
        'cached'    => $cached,
        'pct'       => pct($used, $total),
        'swap'      => ['total' => $swapT, 'used' => max(0, $swapT - $swapF), 'pct' => pct($swapT - $swapF, $swapT)],
    ];
}

/* ---------- cpu, network, misc ---------- */

function cpu_cores(): int {
    $c = rd('/proc/cpuinfo');
    if ($c !== null && ($n = preg_match_all('/^processor\s*:/m', $c)) > 0) return $n;
    $env = (int)getenv('NUMBER_OF_PROCESSORS');
    if ($env > 0) return $env;
    $n = (int)trim((string)sh('nproc'));
    return $n > 0 ? $n : 1;
}

function cpu_jiffies(): ?array {      // [busy, total] since boot
    $s = rd('/proc/stat');
    if ($s === null || !preg_match('/^cpu\s+(.+)$/m', $s, $m)) return null;
    $v = array_map('intval', preg_split('/\s+/', trim($m[1])));
    $idle  = ($v[3] ?? 0) + ($v[4] ?? 0);        // idle + iowait
    $total = array_sum(array_slice($v, 0, 8));
    return [$total - $idle, $total];
}

function net_bytes(): ?array {        // [rx, tx] over all non-loopback interfaces
    $s = rd('/proc/net/dev');
    if ($s === null) return null;
    $rx = $tx = 0;
    foreach (explode("\n", $s) as $line) {
        if (strpos($line, ':') === false) continue;
        [$if, $data] = explode(':', $line, 2);
        if (trim($if) === 'lo') continue;
        $f = preg_split('/\s+/', trim($data));
        $rx += (int)($f[0] ?? 0);
        $tx += (int)($f[8] ?? 0);
    }
    return [$rx, $tx];
}

function uptime_seconds(): ?int {
    $u = rd('/proc/uptime');
    return $u !== null ? (int)floatval($u) : null;
}

function process_count(): ?int {
    $p = @glob('/proc/[0-9]*', GLOB_ONLYDIR);
    return is_array($p) && $p ? count($p) : null;
}

function cpu_temp(): ?float {
    $t = rd('/sys/class/thermal/thermal_zone0/temp');
    return $t !== null && is_numeric(trim($t)) ? round((int)trim($t) / 1000, 1) : null;
}

/* ---------- collect ---------- */

$warn  = [];
$now   = time();
$cores = cpu_cores();
$load  = function_exists('sys_getloadavg') ? (sys_getloadavg() ?: null) : null;
$mem   = read_memory($warn);

$dir        = __DIR__;
$diskTotal  = (float)@disk_total_space($dir);
$diskFree   = (float)@disk_free_space($dir);
$diskUsed   = max(0.0, $diskTotal - $diskFree);

/* ---------- history + rate calculations (CPU %, network speed) ---------- */

$dataDir = __DIR__ . '/data';
if (!is_dir($dataDir)) @mkdir($dataDir, 0750, true);
$file = $dataDir . '/server_history.json';

$state = ['samples' => [], 'raw' => null];
$fh = @fopen($file, 'c+');
if ($fh && flock($fh, LOCK_EX)) {
    $json = stream_get_contents($fh);
    $d = $json ? json_decode($json, true) : null;
    if (is_array($d)) $state = $d + $state;
} else {
    $warn[] = 'Cannot write data/server_history.json, history charts will be empty. Check folder permissions.';
}

$cpuNow = cpu_jiffies();
$netNow = net_bytes();
$raw    = $state['raw'];
$cpuPct = null; $rxBps = null; $txBps = null;

if (is_array($raw) && ($now - ($raw['t'] ?? 0)) > 0) {
    $dt = $now - $raw['t'];
    if ($cpuNow && !empty($raw['cpu']) && $cpuNow[1] > $raw['cpu'][1]) {
        $cpuPct = pct($cpuNow[0] - $raw['cpu'][0], $cpuNow[1] - $raw['cpu'][1]);
    }
    if ($netNow && !empty($raw['net']) && $netNow[0] >= $raw['net'][0]) {
        $rxBps = (int)(($netNow[0] - $raw['net'][0]) / $dt);
        $txBps = (int)(($netNow[1] - $raw['net'][1]) / $dt);
    }
}
if ($cpuPct === null && $load) $cpuPct = min(100.0, pct($load[0], $cores));   // fallback: load per core

$last = end($state['samples']);
if ($fh && (!$last || $now - ($last['t'] ?? 0) >= SAMPLE_EVERY)) {
    $state['samples'][] = [
        't'    => $now,
        'cpu'  => $cpuPct,
        'mem'  => $mem['pct'] ?? null,
        'load' => $load ? round($load[0], 2) : null,
        'disk' => pct($diskUsed, $diskTotal),
        'rx'   => $rxBps,
        'tx'   => $txBps,
        'temp' => cpu_temp(),
    ];
    $state['samples'] = array_slice($state['samples'], -KEEP_SAMPLES);
    $state['raw'] = ['t' => $now, 'cpu' => $cpuNow, 'net' => $netNow];
    ftruncate($fh, 0);
    rewind($fh);
    fwrite($fh, json_encode($state));
}
if ($fh) { fflush($fh); flock($fh, LOCK_UN); fclose($fh); }

$hours = max(1, min(24, (int)($_GET['hours'] ?? 6)));
$since = $now - $hours * 3600;
$hist  = array_values(array_filter($state['samples'], fn($s) => ($s['t'] ?? 0) >= $since));

/* ---------- peaks / averages for the history window ---------- */

$col = fn(string $k) => array_values(array_filter(array_column($hist, $k), fn($v) => $v !== null));
$stat = function (string $k) use ($col): ?array {
    $v = $col($k);
    return $v ? ['avg' => round(array_sum($v) / count($v), 1), 'max' => max($v), 'min' => min($v)] : null;
};

echo json_encode([
    'ok'   => true,
    'time' => $now,
    'host' => [
        'os'      => PHP_OS_FAMILY . ' (' . php_uname('r') . ')',
        'php'     => PHP_VERSION,
        'web'     => $_SERVER['SERVER_SOFTWARE'] ?? null,
        'cores'   => $cores,
        'uptime'  => uptime_seconds(),
        'procs'   => process_count(),
    ],
    'memory' => $mem,
    'cpu'    => [
        'pct'   => $cpuPct,
        'load'  => $load ? array_map(fn($x) => round($x, 2), $load) : null,
        'cores' => $cores,
        'temp'  => cpu_temp(),
    ],
    'disk' => [
        'total' => $diskTotal, 'used' => $diskUsed, 'free' => $diskFree,
        'pct'   => pct($diskUsed, $diskTotal),
    ],
    'net'     => ['rx_bps' => $rxBps, 'tx_bps' => $txBps],
    'php_mem' => ['peak' => memory_get_peak_usage(true), 'limit' => ini_get('memory_limit')],
    'range'   => ['hours' => $hours, 'cpu' => $stat('cpu'), 'mem' => $stat('mem'), 'load' => $stat('load'), 'disk' => $stat('disk')],
    'history' => $hist,
    'warnings' => $warn,
], JSON_UNESCAPED_SLASHES);