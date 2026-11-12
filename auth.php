<?php
declare(strict_types=1);

/**
 * Shared auth helpers. Include at the top of every protected page:
 *   require __DIR__ . '/auth.php';
 *   require_login();            // HTML pages (redirects to login.php)
 *   require_login(true);        // api.php (returns 401 JSON)
 */

$configFile = __DIR__ . '/config.php';
if (!is_file($configFile)) {
    http_response_code(500);
    exit('Missing config.php. Copy config.sample.php to config.php first.');
}
$AUTH = require $configFile;

function auth_start(): void {
    global $AUTH;
    if (session_status() === PHP_SESSION_ACTIVE) return;

    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
          || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');

    session_name($AUTH['session_name']);
    session_set_cookie_params([
        'lifetime' => 0,
        'path'     => '/',
        'secure'   => $https,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    ini_set('session.use_strict_mode', '1');
    session_start();
}

function is_logged_in(): bool {
    global $AUTH;
    auth_start();
    if (empty($_SESSION['uid'])) return false;
    if (time() - ($_SESSION['last'] ?? 0) > $AUTH['idle_timeout']) {
        logout_user();
        return false;
    }
    $_SESSION['last'] = time();
    return true;
}

function require_login(bool $json = false): void {
    if (is_logged_in()) return;
    if ($json) {
        http_response_code(401);
        header('Content-Type: application/json');
        echo json_encode(['error' => 'unauthorized']);
    } else {
        header('Location: login.php');
    }
    exit;
}

function login_user(string $uid): void {
    auth_start();
    session_regenerate_id(true);          // prevents session fixation
    $_SESSION = ['uid' => $uid, 'last' => time()];
}

function logout_user(): void {
    auth_start();
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $p = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000, $p['path'], $p['domain'] ?? '', $p['secure'], $p['httponly']);
    }
    session_destroy();
}

function csrf_token(): string {
    auth_start();
    return $_SESSION['csrf'] ??= bin2hex(random_bytes(32));
}

function csrf_ok(?string $t): bool {
    auth_start();
    return is_string($t) && isset($_SESSION['csrf']) && hash_equals($_SESSION['csrf'], $t);
}

/* ---- brute-force throttle (per IP, stored in the system temp dir) ---- */

function throttle_file(): string {
    $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    return sys_get_temp_dir() . '/qteco_login_' . hash('sha256', $ip) . '.json';
}

function throttle_read(): array {
    global $AUTH;
    $f = throttle_file();
    $d = is_file($f) ? json_decode((string)file_get_contents($f), true) : null;
    $now = time();
    $fails = array_values(array_filter($d['fails'] ?? [], fn($t) => $now - $t < $AUTH['lock_seconds']));
    return $fails;
}

function throttle_locked(): int {            // returns seconds left, 0 = not locked
    global $AUTH;
    $fails = throttle_read();
    if (count($fails) < $AUTH['max_attempts']) return 0;
    return max(0, $AUTH['lock_seconds'] - (time() - min($fails)));
}

function throttle_fail(): void {
    $fails = throttle_read();
    $fails[] = time();
    file_put_contents(throttle_file(), json_encode(['fails' => $fails]), LOCK_EX);
}

function throttle_clear(): void {
    @unlink(throttle_file());
}
