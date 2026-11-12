<?php
declare(strict_types=1);
require __DIR__ . '/auth.php';

if (is_logged_in()) { header('Location: index.php'); exit; }

$users   = $AUTH['users'];
$single  = count($users) === 1;
$error   = '';
$locked  = throttle_locked();
$typed   = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $typed = strtolower(trim((string)($_POST['username'] ?? '')));
    $pass  = (string)($_POST['password'] ?? '');
    if ($single) $typed = (string)array_key_first($users);

    if (!csrf_ok($_POST['csrf'] ?? null)) {
        $error = 'Your session expired. Try again.';
    } elseif ($locked > 0) {
        // keep the message below
    } else {
        $user = $users[$typed] ?? null;
        // Always run password_verify so timing doesn't reveal valid usernames
        $hash = $user['hash'] ?? password_hash('dummy', PASSWORD_DEFAULT);
        $ok   = password_verify($pass, $hash) && $user !== null;

        if ($ok) {
            throttle_clear();
            login_user($typed);
            header('Location: index.php');
            exit;
        }
        throttle_fail();
        $locked = throttle_locked();
        $error  = 'Wrong password. Try again.';
    }
}

if ($locked > 0) {
    $error = 'Too many attempts. Try again in ' . max(1, (int)ceil($locked / 60)) . ' min.';
}

$first   = $single ? $users[array_key_first($users)] : null;
$name    = $first['name'] ?? '';
$e = fn(string $s): string => htmlspecialchars($s, ENT_QUOTES, 'UTF-8');

$LOGO   = 'images/logo.webp';                          // same logo as the dashboard
$AVATAR = $first['avatar'] ?? 'assets/pfp.png';    // profile picture
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Sign in · Qteco</title>
<style>
  :root {
    --font-family: 'Inter', system-ui, Arial, sans-serif;
    --bg-primary: #0f0f14;
    --text-primary: #e4e4ed;
    --text-muted: #6b6b82;
    --blue-ring: rgba(59, 130, 246, 0.4);
    --red: #3a1620; --red-text: #fca5a5; --red-ring: rgba(239, 68, 68, 0.5);
    --glass-bg: rgba(255,255,255,0.055);
    --glass-brd: rgba(255,255,255,0.1);
    --glass-hi: inset 0 1px 0 rgba(255,255,255,0.08);
    --focus-ring: 0 0 0 2px var(--bg-primary), 0 0 0 4px var(--blue-ring);
    color-scheme: dark;
  }
  *, *::before, *::after { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body {
    font-family: var(--font-family);
    color: var(--text-primary);
    -webkit-font-smoothing: antialiased;
    display: grid; place-items: center;
    overflow: hidden;
    background:
      radial-gradient(900px 560px at 8% -8%, rgba(99,102,241,0.28), transparent 65%),
      radial-gradient(800px 560px at 100% 105%, rgba(14,165,233,0.18), transparent 65%),
      var(--bg-primary);
    background-attachment: fixed;
  }
  :focus-visible { outline: none; box-shadow: var(--focus-ring); }

  .card {
    width: min(92vw, 400px);
    padding: 36px 34px 34px;
    text-align: center;
    background: rgba(16,18,30,0.58);
    -webkit-backdrop-filter: blur(24px) saturate(170%);
    backdrop-filter: blur(24px) saturate(170%);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 26px;
    box-shadow: 0 16px 48px rgba(0,0,0,0.38), inset 0 1px 0 rgba(255,255,255,0.1);
    animation: rise .5s cubic-bezier(.2,.8,.2,1) both;
  }
  .card.shake { animation: shake .4s; }

  .logo { display: block; height: 40px; width: auto; max-width: 70%; margin: 0 auto 24px; }
  .logo-text { display: none; margin: 0 auto 24px; font-size: 2rem; font-weight: 800; letter-spacing: -0.03em; }

  /* Profile picture: shows the first letter if the image is missing */
  .avatar {
    position: relative; width: 84px; height: 84px; margin: 0 auto 16px;
    border-radius: 50%; overflow: hidden;
    display: grid; place-items: center;
    background: linear-gradient(135deg, #3b82f6, #6366f1);
    font-size: 2rem; font-weight: 700; color: #fff;
    box-shadow: 0 0 0 2px rgba(255,255,255,0.18), 0 8px 24px rgba(0,0,0,0.4);
  }
  .avatar img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }

  h1 { margin: 0 0 4px; font-size: 1.35rem; font-weight: 700; letter-spacing: -0.02em; }
  .sub { margin: 0 0 22px; font-size: 0.85rem; font-weight: 500; color: var(--text-muted); }

  input, button { width: 100%; height: 46px; border-radius: 12px; font: 600 0.9rem var(--font-family); }
  input {
    margin-bottom: 12px; padding: 0 16px;
    border: 1px solid var(--glass-brd); background: var(--glass-bg);
    box-shadow: var(--glass-hi); color: var(--text-primary);
    transition: border-color .2s, background .2s, box-shadow .2s;
  }
  input::placeholder { color: var(--text-muted); font-weight: 500; }
  input:focus { border-color: var(--blue-ring); background: rgba(255,255,255,0.08); box-shadow: var(--focus-ring); }

  button {
    border: 0; cursor: pointer; color: #fff;
    background: linear-gradient(135deg, #3b82f6, #6366f1);
    box-shadow: 0 6px 18px rgba(79,70,229,0.35);
    transition: transform .15s, filter .2s, opacity .2s;
  }
  button:hover:not(:disabled) { filter: brightness(1.1); transform: translateY(-1px); }
  button:active:not(:disabled) { transform: scale(0.97); }
  button:disabled { opacity: .5; cursor: not-allowed; }

  .error {
    margin: 0 0 12px; padding: 9px 12px; border-radius: 12px;
    background: var(--red); color: var(--red-text); border: 1px solid var(--red-ring);
    font-size: 0.8rem; font-weight: 600;
  }
  .error:empty { display: none; }

  @keyframes rise  { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
  @keyframes shake { 20%,60% { transform: translateX(-8px); } 40%,80% { transform: translateX(8px); } }
  @media (prefers-reduced-motion: reduce) { .card, .card.shake { animation: none; } button { transition: none; } }
</style>
</head>
<body>
  <form class="card <?= $error && $locked === 0 ? 'shake' : '' ?>" method="post" autocomplete="on">

    <img class="logo" src="<?= $e($LOGO) ?>" alt="Qteco"
         onerror="this.onerror=function(){this.style.display='none';this.nextElementSibling.style.display='block'};this.src='images/logo.webp'">
    <div class="logo-text">Qteco</div>

    <?php if ($single): ?>
      <div class="avatar">
        <span><?= $e(strtoupper(substr($name, 0, 1))) ?></span>
        <img src="<?= $e($AVATAR) ?>" alt="" onerror="this.remove()">
      </div>
    <?php endif; ?>

    <h1><?= $single ? 'Welcome back, ' . $e($name) : 'Sign in' ?></h1>
    <p class="sub">Website Health dashboard</p>

    <input type="hidden" name="csrf" value="<?= $e(csrf_token()) ?>">
    <?php if ($single): ?>
      <input type="hidden" name="username" value="<?= $e((string)array_key_first($users)) ?>" autocomplete="username">
    <?php else: ?>
      <input type="text" name="username" placeholder="Username" value="<?= $e($typed) ?>"
             autocomplete="username" required autofocus>
    <?php endif; ?>

    <input type="password" name="password" placeholder="Password"
           autocomplete="current-password" required <?= $single ? 'autofocus' : '' ?>
           <?= $locked > 0 ? 'disabled' : '' ?>>

    <p class="error" role="alert"><?= $e($error) ?></p>
    <button type="submit" <?= $locked > 0 ? 'disabled' : '' ?>>Sign in</button>
  </form>
</body>
</html>