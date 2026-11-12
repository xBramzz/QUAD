<?php
   require __DIR__ . '/auth.php';
   require_login(true); // returns 401 JSON instead of redirecting
/* =========================================================
   WEBSITE HEALTH — api.php
   Live checks + Analytics + Inventory / SSL / DNS / Security
   ========================================================= */

const CACHE_TTL          = 60;
const HISTORY_FILE       = __DIR__ . '/health_history.json';
const RESET_MARKER       = __DIR__ . '/last_history_reset.txt';
const FALLBACK_SOURCE    = 'https://pleskdata.qnimbus.nl/plesk_status.json';
const MAX_HISTORY_HOURS  = 168;

const CURL_TIMEOUT         = 12;
const CURL_CONNECT_TIMEOUT = 6;
const MAX_CONNECTIONS      = 30;

const SCAN_CACHE_TTL   = 21600;  // deep scans (inventory/ssl/dns/security) refresh every 6 h
const SCAN_BATCH       = 12;     // domains enriched per scan pass (Pi-friendly)
const CERT_WARN_DAYS   = 21;

header('Pragma: no-cache');
header('Content-Type: application/json');
header('Cache-Control: no-store');

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
];

const DB_FILE = __DIR__ . '/health.sqlite';
const RANGES  = ['24h' => [86400, 3600], '7d' => [604800, 21600], '30d' => [2592000, 86400]];

/* ---------- DATABASE ---------- */
function db() {
    static $pdo = null;
    if (!$pdo) {
        $pdo = new PDO('sqlite:' . DB_FILE);
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $pdo->exec('PRAGMA journal_mode=WAL');
        $pdo->exec('CREATE TABLE IF NOT EXISTS checks (t INTEGER, url TEXT, s INTEGER, ms INTEGER);
                    CREATE INDEX IF NOT EXISTS checks_t ON checks (t);
                    CREATE TABLE IF NOT EXISTS incidents (id INTEGER PRIMARY KEY, url TEXT, started INTEGER, ended INTEGER, status INTEGER);
                    CREATE TABLE IF NOT EXISTS meta (url TEXT PRIMARY KEY, scanned INTEGER, data TEXT);');
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
            if (!$up && !$id)   $start->execute([$u, $now, $r['status']]);
            elseif ($up && $id) $close->execute([$now, $id]);
        }
        if (random_int(1, 300) === 1) {
            $db->exec('DELETE FROM checks WHERE t < ' . ($now - 2592000));
            $db->exec('DELETE FROM incidents WHERE ended IS NOT NULL AND ended < ' . ($now - 2592000));
        }
        $db->commit();
    } catch (Throwable $e) {
        if (isset($db) && $db->inTransaction()) $db->rollBack();
        error_log('health db: ' . $e->getMessage());
    }
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
    if (!class_exists('mysqli')) return null;
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

function getDomainList() {
    $urls = fetchPleskDomains();
    if ($urls === null) {
        $urls = [];
        $fallback = fetchJson(FALLBACK_SOURCE);
        if (is_array($fallback)) {
            foreach ($fallback as $item) if (isset($item['url'])) $urls[] = $item['url'];
        }
    }
    $urls = array_filter($urls, function ($url) {
        $url = strtolower(trim($url));
        foreach (BLOCKED_DOMAINS as $blocked) {
            $blocked = strtolower(trim($blocked));
            if ($url === $blocked || substr($url, -strlen('.' . $blocked)) === '.' . $blocked) return false;
        }
        return true;
    });
    sort($urls);
    return array_values(array_unique($urls));
}

function runCurl($urls) {
    $results = [];
    if (!$urls) return $results;
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
        if ($status === 0) $ms = 0;
        if ($ms > 5000) $ms = 5000;
        $results[$u] = ['status' => $status, 'ms' => $ms];
        curl_multi_remove_handle($mh, $ch);
        curl_close($ch);
    }
    curl_multi_close($mh);
    curl_share_close($share);
    return $results;
}

/* ---------- SERVER STATS ---------- */
function getMemory() {
    $raw = @file_get_contents('/proc/meminfo');
    if ($raw !== false) {
        if (preg_match('/MemTotal:\s+(\d+)/', $raw, $t) &&
            (preg_match('/MemAvailable:\s+(\d+)/', $raw, $a) || preg_match('/MemFree:\s+(\d+)/', $raw, $a))) {
            $total = (int) $t[1];
            if ($total > 0) return [
                'percent' => round(($total - (int) $a[1]) / $total * 100, 1),
                'total_mb' => round($total / 1024),
                'used_mb' => round(($total - (int) $a[1]) / 1024),
            ];
        }
    }
    return null;
}

function getServerStats() {
    $disk = null;
    foreach ([__DIR__, '/', 'C:\\'] as $path) {
        $total = @disk_total_space($path); $free = @disk_free_space($path);
        if ($total) {
            $disk = [
                'percent' => round(($total - $free) / $total * 100, 1),
                'total_gb' => round($total / 1073741824, 1),
                'free_gb' => round($free / 1073741824, 1),
            ];
            break;
        }
    }
    return ['mem' => getMemory(), 'disk' => $disk];
}

function getServerInfo() {
    $info = [
        'php' => PHP_VERSION,
        'os' => php_uname('s') . ' ' . php_uname('r'),
        'host' => gethostname() ?: 'unknown',
        'time' => date('c'),
        'timezone' => date_default_timezone_get(),
        'load' => function_exists('sys_getloadavg') ? sys_getloadavg() : null,
        'uptime' => null,
        'extensions' => [
            'curl' => extension_loaded('curl'),
            'pdo_sqlite' => extension_loaded('pdo_sqlite'),
            'mysqli' => extension_loaded('mysqli'),
            'openssl' => extension_loaded('openssl'),
        ],
    ];
    $up = @file_get_contents('/proc/uptime');
    if ($up !== false) $info['uptime'] = (int) floatval($up);
    $stats = getServerStats();
    $info['mem'] = $stats['mem'];
    $info['disk'] = $stats['disk'];
    try {
        $db = db();
        $info['db'] = [
            'checks' => (int) $db->query('SELECT COUNT(*) FROM checks')->fetchColumn(),
            'incidents' => (int) $db->query('SELECT COUNT(*) FROM incidents')->fetchColumn(),
            'scanned' => (int) $db->query('SELECT COUNT(*) FROM meta')->fetchColumn(),
            'size_kb' => is_file(DB_FILE) ? round(filesize(DB_FILE) / 1024) : 0,
        ];
    } catch (Throwable $e) { $info['db'] = null; }
    return $info;
}

/* ---------- HISTORY ---------- */
function loadHistory() {
    if (is_file(HISTORY_FILE)) {
        $data = json_decode(file_get_contents(HISTORY_FILE), true);
        if (is_array($data)) return $data;
    }
    return [];
}

function saveHistory($history) {
    $maxEntries = MAX_HISTORY_HOURS * 6;
    foreach ($history as $url => &$entries) {
        if (count($entries) > $maxEntries) $entries = array_slice($entries, -$maxEntries);
    }
    file_put_contents(HISTORY_FILE, json_encode($history), LOCK_EX);
}

/* =========================================================
   DEEP SCAN — inventory / ssl / dns / security metadata
   ========================================================= */
function scanDomain($url) {
    $m = ['url' => $url, 'scanned' => time()];

    /* --- DNS --- */
    $dns = ['a' => [], 'aaaa' => [], 'mx' => [], 'ns' => [], 'txt' => [], 'cname' => null];
    $recs = @dns_get_record($url, DNS_A + DNS_AAAA + DNS_MX + DNS_NS + DNS_TXT + DNS_CNAME);
    if (is_array($recs)) {
        foreach ($recs as $r) {
            switch ($r['type']) {
                case 'A':     $dns['a'][] = $r['ip']; break;
                case 'AAAA':  $dns['aaaa'][] = $r['ipv6']; break;
                case 'MX':    $dns['mx'][] = ['pri' => $r['pri'], 'target' => $r['target']]; break;
                case 'NS':    $dns['ns'][] = $r['target']; break;
                case 'TXT':   $dns['txt'][] = $r['txt']; break;
                case 'CNAME': $dns['cname'] = $r['target']; break;
            }
        }
    }
    $dns['a'] = array_values(array_unique($dns['a']));
    $dns['ns'] = array_values(array_unique($dns['ns']));
    $m['dns'] = $dns;
    $m['ip'] = $dns['a'][0] ?? null;

    /* --- HTTP fingerprint + security headers --- */
    $ch = curl_init('https://' . $url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true, CURLOPT_MAXREDIRS => 5,
        CURLOPT_CONNECTTIMEOUT => CURL_CONNECT_TIMEOUT, CURLOPT_TIMEOUT => CURL_TIMEOUT,
        CURLOPT_USERAGENT => 'Mozilla/5.0 (compatible; WebsiteHealth/1.0)',
        CURLOPT_SSL_VERIFYPEER => false, CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_HEADER => true,
        CURLOPT_ENCODING => '',
    ]);
    $resp = curl_exec($ch);
    $info = curl_getinfo($ch);
    $err  = curl_error($ch);
    curl_close($ch);

    $http = ['status' => (int) $info['http_code'], 'final_url' => $info['url'],
             'redirects' => (int) $info['redirect_count'], 'error' => $err ?: null,
             'server' => null, 'powered_by' => null, 'title' => null, 'tech' => [],
             'headers' => [], 'size_kb' => round(((int) $info['size_download']) / 1024, 1)];
    if ($resp !== false) {
        $headerSize = (int) $info['header_size'];
        $rawHeaders = substr($resp, 0, $headerSize);
        $body = substr($resp, $headerSize);
        // use the LAST header block (after redirects)
        $blocks = preg_split('/\r?\n\r?\n/', trim($rawHeaders));
        $lastBlock = end($blocks);
        $headers = [];
        foreach (preg_split('/\r?\n/', $lastBlock) as $line) {
            if (strpos($line, ':') !== false) {
                [$k, $v] = explode(':', $line, 2);
                $headers[strtolower(trim($k))] = trim($v);
            }
        }
        $http['headers'] = $headers;
        $http['server'] = $headers['server'] ?? null;
        $http['powered_by'] = $headers['x-powered-by'] ?? null;
        if (preg_match('/<title[^>]*>(.*?)<\/title>/is', $body, $tm)) {
            $http['title'] = trim(html_entity_decode(strip_tags($tm[1]), ENT_QUOTES, 'UTF-8'));
            if (mb_strlen($http['title']) > 120) $http['title'] = mb_substr($http['title'], 0, 117) . '…';
        }
        // tech detection from body + headers
        $tech = [];
        $hay = strtolower($body);
        $gen = '';
        if (preg_match('/<meta[^>]+name=["\']generator["\'][^>]+content=["\']([^"\']+)/i', $body, $gm)) $gen = strtolower($gm[1]);
        if (strpos($hay, 'wp-content') !== false || strpos($gen, 'wordpress') !== false) $tech[] = 'WordPress';
        if (strpos($hay, 'joomla') !== false || strpos($gen, 'joomla') !== false) $tech[] = 'Joomla';
        if (strpos($hay, 'drupal') !== false || strpos($gen, 'drupal') !== false) $tech[] = 'Drupal';
        if (strpos($hay, 'typo3') !== false) $tech[] = 'TYPO3';
        if (strpos($hay, 'shopify') !== false) $tech[] = 'Shopify';
        if (strpos($hay, 'wix.com') !== false || strpos($gen, 'wix') !== false) $tech[] = 'Wix';
        if (strpos($hay, 'squarespace') !== false) $tech[] = 'Squarespace';
        if (strpos($hay, 'laravel') !== false || isset($headers['x-laravel'])) $tech[] = 'Laravel';
        if (strpos($hay, '/_next/') !== false) $tech[] = 'Next.js';
        if (strpos($hay, 'react') !== false && strpos($hay, '__next') === false) $tech[] = 'React';
        if (strpos($hay, 'vue') !== false) $tech[] = 'Vue';
        if (strpos($hay, 'jquery') !== false) $tech[] = 'jQuery';
        if (strpos($hay, 'bootstrap') !== false) $tech[] = 'Bootstrap';
        if (strpos($hay, 'elementor') !== false) $tech[] = 'Elementor';
        if (strpos($hay, 'woocommerce') !== false) $tech[] = 'WooCommerce';
        if (strpos($hay, 'cloudflare') !== false || isset($headers['cf-ray'])) $tech[] = 'Cloudflare';
        if (stripos($http['server'] ?? '', 'nginx') !== false) $tech[] = 'nginx';
        if (stripos($http['server'] ?? '', 'apache') !== false) $tech[] = 'Apache';
        if (stripos($http['server'] ?? '', 'litespeed') !== false) $tech[] = 'LiteSpeed';
        if ($http['powered_by'] && stripos($http['powered_by'], 'php') !== false) $tech[] = 'PHP';
        if ($gen && !$tech) $tech[] = ucfirst($gen);
        $http['tech'] = array_values(array_unique($tech));
    }
    $m['http'] = $http;

    /* --- Security header audit --- */
    $h = $http['headers'];
    $checks = [
        'hsts'        => isset($h['strict-transport-security']),
        'csp'         => isset($h['content-security-policy']),
        'xframe'      => isset($h['x-frame-options']) || (isset($h['content-security-policy']) && stripos($h['content-security-policy'], 'frame-ancestors') !== false),
        'xcto'        => isset($h['x-content-type-options']) && stripos($h['x-content-type-options'], 'nosniff') !== false,
        'referrer'    => isset($h['referrer-policy']),
        'permissions' => isset($h['permissions-policy']),
        'https'       => strpos($http['final_url'] ?? '', 'https://') === 0,
    ];
    $score = count(array_filter($checks));
    $grade = $score >= 7 ? 'A' : ($score >= 5 ? 'B' : ($score >= 3 ? 'C' : ($score >= 1 ? 'D' : 'F')));
    if ($http['status'] === 0) $grade = '?';
    $m['security'] = ['checks' => $checks, 'score' => $score, 'grade' => $grade];

    /* --- TLS certificate --- */
    $cert = null;
    $ctx = stream_context_create(['ssl' => [
        'capture_peer_cert' => true, 'verify_peer' => false, 'verify_peer_name' => false,
        'SNI_enabled' => true, 'peer_name' => $url,
    ]]);
    $client = @stream_socket_client('ssl://' . $url . ':443', $errno, $errstr, 8, STREAM_CLIENT_CONNECT, $ctx);
    if ($client) {
        $params = stream_context_get_params($client);
        fclose($client);
        if (!empty($params['options']['ssl']['peer_certificate'])) {
            $parsed = openssl_x509_parse($params['options']['ssl']['peer_certificate']);
            if ($parsed) {
                $now = time();
                $daysLeft = (int) floor(($parsed['validTo_time_t'] - $now) / 86400);
                $sans = [];
                if (isset($parsed['extensions']['subjectAltName'])) {
                    foreach (explode(',', $parsed['extensions']['subjectAltName']) as $san) {
                        $sans[] = trim(str_replace('DNS:', '', $san));
                    }
                }
                $issuer = $parsed['issuer']['O'] ?? ($parsed['issuer']['CN'] ?? 'Unknown');
                $cert = [
                    'issuer' => $issuer,
                    'subject' => $parsed['subject']['CN'] ?? $url,
                    'valid_from' => $parsed['validFrom_time_t'],
                    'valid_to' => $parsed['validTo_time_t'],
                    'days_left' => $daysLeft,
                    'expired' => $daysLeft < 0,
                    'expiring' => $daysLeft >= 0 && $daysLeft <= CERT_WARN_DAYS,
                    'sans' => array_slice($sans, 0, 20),
                    'serial' => $parsed['serialNumberHex'] ?? null,
                ];
            }
        }
    }
    $m['cert'] = $cert;

    /* --- Classification --- */
    $parts = explode('.', strtolower($url));
    $m['tld'] = end($parts);
    // simple registrable-domain heuristic (handles co.uk etc.)
    $twoLevel = ['co.uk', 'org.uk', 'com.au', 'co.nz', 'co.za', 'com.br', 'co.jp'];
    $n = count($parts);
    $root = $n >= 3 && in_array($parts[$n-2] . '.' . $parts[$n-1], $twoLevel)
        ? implode('.', array_slice($parts, -3))
        : implode('.', array_slice($parts, -2));
    $m['root'] = $root;
    $m['is_subdomain'] = strtolower($url) !== $root;

    return $m;
}

function ensureScans($urls, $force = false) {
    try {
        $db = db();
        $rows = $db->query('SELECT url, scanned FROM meta')->fetchAll(PDO::FETCH_KEY_PAIR);
        $now = time();
        $todo = [];
        foreach ($urls as $u) {
            if ($force || !isset($rows[$u]) || ($now - (int)$rows[$u]) > SCAN_CACHE_TTL) $todo[] = $u;
        }
        // oldest first, batched to keep each request fast on the Pi
        usort($todo, function ($a, $b) use ($rows) { return ($rows[$a] ?? 0) <=> ($rows[$b] ?? 0); });
        $batch = array_slice($todo, 0, $force ? count($todo) : SCAN_BATCH);
        if ($batch) {
            $st = $db->prepare('INSERT OR REPLACE INTO meta (url, scanned, data) VALUES (?, ?, ?)');
            foreach ($batch as $u) {
                $data = scanDomain($u);
                $st->execute([$u, time(), json_encode($data)]);
            }
        }
        return ['pending' => max(0, count($todo) - count($batch)), 'scanned_now' => count($batch)];
    } catch (Throwable $e) {
        error_log('scan: ' . $e->getMessage());
        return ['pending' => 0, 'scanned_now' => 0, 'error' => 'Scan storage unavailable'];
    }
}

function loadMeta($urls) {
    $out = [];
    try {
        $db = db();
        $st = $db->prepare('SELECT data FROM meta WHERE url = ?');
        foreach ($urls as $u) {
            $st->execute([$u]);
            $json = $st->fetchColumn();
            if ($json) {
                $d = json_decode($json, true);
                if (is_array($d)) { $out[$u] = $d; continue; }
            }
            $out[$u] = ['url' => $u, 'scanned' => null];
        }
    } catch (Throwable $e) { /* db optional */ }
    return $out;
}

/* =========================================================
   ROUTES
   ========================================================= */
$action = $_GET['action'] ?? '';

/* --- STATS (analytics + incidents) --- */
if ($action === 'stats') {
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

/* --- INVENTORY / SSL / DNS / DOMAINS / SECURITY (shared meta store) --- */
if (in_array($action, ['inventory', 'certs', 'dns', 'domains', 'security'], true)) {
    $urls = getDomainList();
    $progress = ensureScans($urls, ($_GET['refresh'] ?? '') === '1');
    $meta = loadMeta($urls);

    // attach latest live status where we have it
    $history = loadHistory();
    foreach ($meta as $u => &$d) {
        $h = $history[$u] ?? [];
        $last = $h ? end($h) : null;
        $d['live'] = $last ? ['status' => $last['s'], 'ms' => $last['ms'], 't' => $last['t']] : null;
    }
    unset($d);

    $out = ['generated' => date('c'), 'progress' => $progress, 'count' => count($urls)];

    if ($action === 'domains') {
        $groups = [];
        foreach ($meta as $u => $d) {
            $root = $d['root'] ?? $u;
            if (!isset($groups[$root])) $groups[$root] = ['root' => $root, 'tld' => $d['tld'] ?? '', 'sites' => []];
            $groups[$root]['sites'][] = [
                'url' => $u,
                'is_subdomain' => $d['is_subdomain'] ?? false,
                'status' => $d['live']['status'] ?? ($d['http']['status'] ?? null),
                'ip' => $d['ip'] ?? null,
            ];
        }
        ksort($groups);
        $tlds = [];
        foreach ($meta as $d) { $t = $d['tld'] ?? '?'; $tlds[$t] = ($tlds[$t] ?? 0) + 1; }
        arsort($tlds);
        $out['groups'] = array_values($groups);
        $out['tlds'] = $tlds;
    } else {
        $out['sites'] = array_values($meta);
    }
    echo json_encode($out);
    exit;
}

/* --- SERVER INFO --- */
if ($action === 'server') {
    echo json_encode(['generated' => date('c'), 'server' => getServerInfo(), 'domains' => count(getDomainList())]);
    exit;
}

/* =========================================================
   LIVE CHECKS (default route)
   ========================================================= */
$resetUrl = $_GET['reset'] ?? null;
$forceReset = !empty($resetUrl);
$forceAll = $resetUrl === 'all';

$cacheFile = sys_get_temp_dir() . '/website_health_cache.json';
if (!$forceReset && is_file($cacheFile) && (time() - filemtime($cacheFile)) < CACHE_TTL) {
    readfile($cacheFile);
    exit;
}

$eightHours = 8 * 60 * 60;
if (!file_exists(RESET_MARKER) || (time() - filemtime(RESET_MARKER)) > $eightHours) {
    $fp = @fopen(HISTORY_FILE, 'c');
    if ($fp) {
        if (flock($fp, LOCK_EX)) { ftruncate($fp, 0); fwrite($fp, '{}'); flock($fp, LOCK_UN); }
        fclose($fp);
    }
    file_put_contents(RESET_MARKER, time());
}

$urls = getDomainList();

if ($forceReset && !$forceAll) {
    // Only allow re-checking a site that's already in the known list (SSRF guard).
    $urls = in_array($resetUrl, $urls, true) ? [$resetUrl] : [];
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

// opportunistic background enrichment: a small batch per live pass
ensureScans($urls);

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
        if (flock($fp, LOCK_EX)) { ftruncate($fp, 0); fwrite($fp, $json); flock($fp, LOCK_UN); }
        fclose($fp);
    }
}

echo $json;