<?php
/* =========================================================
   WEBSITE HEALTH — api.php (Pi-optimised, 8-Hour Wipe)
   ========================================================= */

const CACHE_TTL          = 60; // 1 minute real-time
const HISTORY_FILE       = __DIR__ . '/health_history.json';
const RESET_MARKER       = __DIR__ . '/last_history_reset.txt';
const FALLBACK_SOURCE    = 'https://pleskdata.qnimbus.nl/plesk_status.json';
const MAX_HISTORY_HOURS  = 168; 

const PLESK_HOST    = '';   
const PLESK_API_KEY = '';   

const CURL_TIMEOUT         = 12;
const CURL_CONNECT_TIMEOUT = 6;
const MAX_CONNECTIONS      = 30;

header('Pragma: no-cache');
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Cache-Control: no-store');

/* --- Blocked Domains (these will be completely hidden from the dashboard) ---
   Add any domains/subdomains you want to exclude. Case-insensitive matching. */
const BLOCKED_DOMAINS = [
    'dev.t-800.qteco.nl',
    'domi.qteco.nl',
    'matomo.qteco.nl',
	'pensive-engelbart.136-144-251-198.plesk.page',
	'retell.qteco.nl',
	'smarttransportation.eu',
	'intelligentvending.eu',
	'aaeon.eu',
	'7fameindhoven.nl',
	'dev.qnimbus.nl',
	'mta-sts.qteco.nl',

	// Add more as needed...
];


/* ---------- SQLITE ANALYTICS (long-term history, survives the 8-hour wipe) ---------- */
const DB_FILE = __DIR__ . '/health.sqlite';
const RANGES  = ['24h' => [86400, 3600], '7d' => [604800, 21600], '30d' => [2592000, 86400]]; // [seconds, bucket]

function db() {
    static $pdo = null;
    if (!$pdo) {
        $pdo = new PDO('sqlite:' . DB_FILE);
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $pdo->exec('PRAGMA journal_mode=WAL');
        $pdo->exec('CREATE TABLE IF NOT EXISTS checks (t INTEGER, url TEXT, s INTEGER, ms INTEGER);
                    CREATE INDEX IF NOT EXISTS checks_t ON checks (t);
                    CREATE TABLE IF NOT EXISTS incidents (id INTEGER PRIMARY KEY, url TEXT, started INTEGER, ended INTEGER, status INTEGER);');
    }
    return $pdo;
}

function logChecks($results, $now) {
    try {
        $db = db();
        $db->beginTransaction();
        $ins   = $db->prepare('INSERT INTO checks VALUES (?, ?, ?, ?)');
        $open  = $db->prepare('SELECT id FROM incidents WHERE url = ? AND ended IS NULL');
        $start = $db->prepare('INSERT INTO incidents (url, started, status) VALUES (?, ?, ?)');
        $close = $db->prepare('UPDATE incidents SET ended = ? WHERE id = ?');
        foreach ($results as $u => $r) {
            $ins->execute([$now, $u, $r['status'], $r['ms']]);
            $up = $r['status'] >= 200 && $r['status'] < 400;
            $open->execute([$u]);
            $id = $open->fetchColumn();
            if (!$up && !$id)     $start->execute([$u, $now, $r['status']]);
            elseif ($up && $id)   $close->execute([$now, $id]);
        }
        if (random_int(1, 300) === 1) { // 30-day retention
            $db->exec('DELETE FROM checks WHERE t < ' . ($now - 2592000));
            $db->exec('DELETE FROM incidents WHERE ended IS NOT NULL AND ended < ' . ($now - 2592000));
        }
        $db->commit();
    } catch (Throwable $e) {
        if (isset($db) && $db->inTransaction()) $db->rollBack();
        error_log('health db: ' . $e->getMessage());
    }
}

if (($_GET['action'] ?? '') === 'stats') {
    try {
        [$span, $bucket] = RANGES[$_GET['range'] ?? '24h'] ?? RANGES['24h'];
        $since = time() - $span;
        $db = db();
        $up = 's >= 200 AND s < 400';
        $q = function ($sql, $args = []) use ($db) { $st = $db->prepare($sql); $st->execute($args); return $st->fetchAll(PDO::FETCH_ASSOC); };
        $summary = $q("SELECT COUNT(*) checks, SUM($up) up, AVG(CASE WHEN $up THEN ms END) avg FROM checks WHERE t >= ?", [$since])[0];
        $summary['incidents'] = (int) $q('SELECT COUNT(*) c FROM incidents WHERE started >= ?', [$since])[0]['c'];
        echo json_encode([
            'range'     => $_GET['range'] ?? '24h',
            'summary'   => $summary,
            'sites'     => $q("SELECT url, COUNT(*) checks, ROUND(100.0 * SUM($up) / COUNT(*), 2) uptime, ROUND(AVG(CASE WHEN $up THEN ms END)) avg, MAX(ms) max FROM checks WHERE t >= ? GROUP BY url", [$since]),
            'timeline'  => $q("SELECT (t / $bucket) * $bucket b, COUNT(*) n, SUM($up) up, AVG(CASE WHEN $up THEN ms END) avg FROM checks WHERE t >= ? GROUP BY b ORDER BY b", [$since]),
            'incidents' => $q('SELECT url, started, ended, status FROM incidents WHERE started >= ? OR ended IS NULL ORDER BY started DESC LIMIT 100', [$since]),
        ]);
    } catch (Throwable $e) {
        http_response_code(500);
        echo json_encode(['error' => 'Analytics database unavailable. Check that php-sqlite3 is installed and the folder is writable.']);
    }
    exit;
}

$resetUrl = $_GET['reset'] ?? null;
$forceReset = !empty($resetUrl);

$cacheFile = sys_get_temp_dir() . '/website_health_cache.json';
if (!$forceReset && is_file($cacheFile) && (time() - filemtime($cacheFile)) < CACHE_TTL) {
    readfile($cacheFile);
    exit;
}

/* ---------- 8-HOUR SAFE HISTORY WIPE ---------- */
$eightHours = 8 * 60 * 60; // 28800 seconds
if (!file_exists(RESET_MARKER) || (time() - filemtime(RESET_MARKER)) > $eightHours) {
    // Safely wipe the history file using exclusive locking
    $fp = @fopen(HISTORY_FILE, 'c');
    if ($fp) {
        if (flock($fp, LOCK_EX)) {
            ftruncate($fp, 0);
            fwrite($fp, '{}'); // Write empty JSON object so it doesn't break on next read
            flock($fp, LOCK_UN);
        }
        fclose($fp);
    }
    // Update the marker file so we wait another 8 hours
    file_put_contents(RESET_MARKER, time());
}

/* ---------- HELPERS ---------- */
function fetchJson($url, $extraHeaders = []) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 10, CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_USERAGENT => 'WebsiteHealth/1.0', CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_HTTPHEADER => $extraHeaders
    ]);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    if ($body === false || $code !== 200) return null;
    $data = json_decode($body, true);
    return is_array($data) ? $data : null;
}

function fetchPleskDomains() {
    $shadow = @file_get_contents('/etc/psa/.psa.shadow');
    if (!$shadow) return null;
    $conn = @new mysqli('localhost', 'admin', trim($shadow), 'psa');
    if ($conn->connect_error) return null;
    $all = [];
    $res = $conn->query("SELECT name FROM domains WHERE status = 0");
    if ($res) while ($row = $res->fetch_assoc()) $all[] = $row['name'];
    $res = $conn->query("SELECT CONCAT(s.name, '.', d.name) AS fullname FROM subdomains s JOIN domains d ON s.dom_id = d.id WHERE d.status = 0");
    if ($res) while ($row = $res->fetch_assoc()) $all[] = $row['fullname'];
    $res = $conn->query("SELECT da.name FROM dom_aliases da JOIN domains d ON da.dom_id = d.id WHERE da.status = 0 AND d.status = 0");
    if ($res) while ($row = $res->fetch_assoc()) $all[] = $row['name'];
    $conn->close();
    return !empty($all) ? array_values(array_unique($all)) : null;
}

function runCurl($urls) {
    $results = [];
    $mh = curl_multi_init();
    curl_multi_setopt($mh, CURLMOPT_MAX_TOTAL_CONNECTIONS, MAX_CONNECTIONS);
    $share = curl_share_init();
    curl_share_setopt($share, CURLSHOPT_SHARE, CURL_LOCK_DATA_DNS);
    $handles = [];
    
    foreach ($urls as $u) {
        $ch = curl_init('https://' . $u);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true, CURLOPT_NOBODY => false,
            CURLOPT_FOLLOWLOCATION => true, CURLOPT_MAXREDIRS => 3,
            CURLOPT_CONNECTTIMEOUT => CURL_CONNECT_TIMEOUT, CURLOPT_TIMEOUT => CURL_TIMEOUT,
            CURLOPT_USERAGENT => 'Mozilla/5.0 (compatible; WebsiteHealth/1.0)',
            CURLOPT_SSL_VERIFYPEER => false, CURLOPT_SSL_VERIFYHOST => false,
            CURLOPT_SHARE => $share,
        ]);
        curl_multi_add_handle($mh, $ch);
        $handles[$u] = $ch;
    }

    do {
        $running = curl_multi_exec($mh, $active);
        if ($active) curl_multi_select($mh, 0.5);
    } while ($active && $running === CURLM_OK);

    foreach ($handles as $u => $ch) {
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $ms     = (int) round(curl_getinfo($ch, CURLINFO_TOTAL_TIME) * 1000);

        if ($status === 0) $ms = 0; // Timeout fix
        if ($ms > 5000) $ms = 5000; // Sparkline cap

        $results[$u] = ['status' => $status, 'ms' => $ms];
        curl_multi_remove_handle($mh, $ch);
        curl_close($ch);
    }
    curl_multi_close($mh);
    curl_share_close($share);
    return $results;
}

/* ---------- ROBUST RAM & DISK TRACKING ---------- */
function getMemory() {
    $raw = @file_get_contents('/proc/meminfo');
    if ($raw !== false) {
        if (preg_match('/MemTotal:\s+(\d+)/', $raw, $t) &&
            (preg_match('/MemAvailable:\s+(\d+)/', $raw, $a) || preg_match('/MemFree:\s+(\d+)/', $raw, $a))) {
            $total = (int) $t[1];
            if ($total > 0) return ['percent' => round(($total - (int) $a[1]) / $total * 100, 1)];
        }
    }
    if (function_exists('shell_exec')) {
        $free = @shell_exec('free 2>/dev/null');
        if ($free && preg_match('/Mem:\s+(\d+)\s+(\d+)/', $free, $m)) {
            $total = (int) $m[1];
            if ($total > 0) return ['percent' => round((int) $m[2] / $total * 100, 1)];
        }
        $win = @shell_exec('wmic OS get TotalVisibleMemorySize,FreePhysicalMemory /format:list 2>nul');
        if ($win && preg_match('/TotalVisibleMemorySize=(\d+)/', $win, $t)
                  && preg_match('/FreePhysicalMemory=(\d+)/', $win, $f)) {
            $total = (int) $t[1];
            if ($total > 0) return ['percent' => round(($total - (int) $f[1]) / $total * 100, 1)];
        }
    }
    return null;
}

function getServerStats() {
    $disk = null;
    foreach ([__DIR__, '/', 'C:\\'] as $path) {
        $total = @disk_total_space($path); $free = @disk_free_space($path);
        if ($total) { $disk = ['percent' => round(($total - $free) / $total * 100, 1)]; break; }
    }
    return ['mem' => getMemory(), 'disk' => $disk];
}

/* ---------- HISTORY MANAGEMENT ---------- */
function loadHistory() {
    if (is_file(HISTORY_FILE)) {
        $data = json_decode(file_get_contents(HISTORY_FILE), true);
        if (is_array($data)) return $data;
    }
    return [];
}

function saveHistory($history) {
    $maxEntries = (MAX_HISTORY_HOURS * 6);
    foreach ($history as $url => &$entries) {
        if (count($entries) > $maxEntries) $entries = array_slice($entries, -$maxEntries);
    }
    file_put_contents(HISTORY_FILE, json_encode($history), LOCK_EX);
}

/* ---------- BUILD & EXECUTE ---------- */
$urls = [];
$pleskUrls = fetchPleskDomains();
if ($pleskUrls !== null) {
    $urls = $pleskUrls;
} else {
    $fallback = fetchJson(FALLBACK_SOURCE);
    if (is_array($fallback)) {
        foreach ($fallback as $item) {
            if (isset($item['url'])) $urls[] = $item['url'];
        }
    }
}

// After fetching $urls from Plesk or fallback...
// Filter out blocked domains
$urls = array_filter($urls, function($url) {
    $url = strtolower(trim($url));
    foreach (BLOCKED_DOMAINS as $blocked) {
        $blocked = strtolower(trim($blocked));
        // Exact match OR subdomain match (e.g., blocking 'test.com' also blocks 'sub.test.com')
        if ($url === $blocked || substr($url, -strlen('.' . $blocked)) === '.' . $blocked) {
            return false;
        }
    }
    return true;
});
$urls = array_values($urls); // Re-index the array

if ($forceReset && !in_array($resetUrl, $urls, true)) {
    $urls = []; // only re-check known sites (prevents server-side requests to arbitrary hosts)
} elseif ($forceReset && in_array($resetUrl, $urls)) {
    $urls = [$resetUrl];
} elseif ($forceReset) {
    $urls = [$resetUrl]; 
}

$checkResults = runCurl($urls);
$history = loadHistory();
$now = time();

foreach ($checkResults as $url => $data) {
    if (!isset($history[$url])) $history[$url] = [];
    $history[$url][] = ['t' => $now, 's' => $data['status'], 'ms' => $data['ms']];
}

saveHistory($history);
logChecks($checkResults, $now);

$currentSites = [];
foreach ($checkResults as $url => $data) {
    $currentSites[] = ['url' => $url, 'status' => $data['status'], 'ms' => $data['ms']];
}

$out = [
    'generated' => date('c'),
    'reset'     => $forceReset ? $resetUrl : false,
    'sites'     => $currentSites,
    'history'   => $history,
    'server'    => getServerStats(),
];

$json = json_encode($out);

if (!$forceReset) {
    $fp = @fopen($cacheFile, 'c');
    if ($fp) {
        if (flock($fp, LOCK_EX)) {
            ftruncate($fp, 0);
            fwrite($fp, $json);
            flock($fp, LOCK_UN);
        }
        fclose($fp);
    }
}

echo $json;