<?php
declare(strict_types=1);
require __DIR__ . '/auth.php';

// POST + CSRF so other sites can't log you out with an <img> tag.
if ($_SERVER['REQUEST_METHOD'] === 'POST' && csrf_ok($_POST['csrf'] ?? null)) {
    logout_user();
}
header('Location: login.php');
exit;
