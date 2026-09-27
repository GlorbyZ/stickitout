<?php
/**
 * Stick It Out lead capture for free lesson + waitlist.
 * POST JSON: { name, email, source, plan? }
 * Stores under /data/leads.json (blocked from web).
 */
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    header('Access-Control-Allow-Methods: POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
    http_response_code(204);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'error' => 'method_not_allowed']);
    exit;
}

$raw = file_get_contents('php://input') ?: '';
$data = json_decode($raw, true);
if (!is_array($data)) {
    $data = $_POST;
}

// Honeypot
if (!empty($data['company']) || !empty($data['website'])) {
    echo json_encode(['ok' => true]);
    exit;
}

$email = strtolower(trim((string) ($data['email'] ?? '')));
$name = trim((string) ($data['name'] ?? ''));
if ($name === '' && $email !== '') {
    $name = strstr($email, '@', true) ?: 'member';
}
$source = preg_replace('/[^a-z0-9_-]/i', '', (string) ($data['source'] ?? 'unknown')) ?: 'unknown';
$plan = preg_replace('/[^a-z0-9_-]/i', '', (string) ($data['plan'] ?? '')) ?: null;

if ($name === '' || strlen($name) > 120) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'invalid_name']);
    exit;
}

if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 190) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'invalid_email']);
    exit;
}

$dataDir = dirname(__DIR__) . '/data';
if (!is_dir($dataDir)) {
    @mkdir($dataDir, 0750, true);
}

$leadsFile = $dataDir . '/leads.json';
$lockFile = $dataDir . '/leads.lock';

$fp = fopen($lockFile, 'c+');
if ($fp === false || !flock($fp, LOCK_EX)) {
    http_response_code(503);
    echo json_encode(['ok' => false, 'error' => 'busy']);
    exit;
}

$leads = [];
if (is_file($leadsFile)) {
    $existing = json_decode((string) file_get_contents($leadsFile), true);
    if (is_array($existing)) {
        $leads = $existing;
    }
}

// Deduplicate by email + source (update name/plan/time)
$now = gmdate('c');
$ip = $_SERVER['REMOTE_ADDR'] ?? '';
$ua = substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 180);
$found = false;
foreach ($leads as &$row) {
    if (
        isset($row['email'], $row['source'])
        && strtolower((string) $row['email']) === $email
        && (string) $row['source'] === $source
    ) {
        $row['name'] = $name;
        $row['plan'] = $plan;
        $row['updatedAt'] = $now;
        $row['ip'] = $ip;
        $found = true;
        break;
    }
}
unset($row);

if (!$found) {
    $leads[] = [
        'id' => bin2hex(random_bytes(8)),
        'name' => $name,
        'email' => $email,
        'source' => $source,
        'plan' => $plan,
        'createdAt' => $now,
        'updatedAt' => $now,
        'ip' => $ip,
        'ua' => $ua,
    ];
}

file_put_contents(
    $leadsFile,
    json_encode($leads, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n",
    LOCK_EX
);

flock($fp, LOCK_UN);
fclose($fp);

// Optional notify + Worker ingest (capture-config.php written by ship).
// Lead is already saved above. Config/notify/forward failures must not fail the response.
$configFile = $dataDir . '/capture-config.php';
$cfg = [];
if (is_file($configFile)) {
    try {
        /** @var mixed $loaded */
        $loaded = include $configFile;
        if (is_array($loaded)) {
            $cfg = $loaded;
        }
    } catch (Throwable $e) {
        $cfg = [];
    }
}

$to = trim((string) ($cfg['notifyTo'] ?? ''));
if ($to !== '' && filter_var($to, FILTER_VALIDATE_EMAIL)) {
    $from = trim((string) ($cfg['notifyFrom'] ?? 'noreply@stickitoutbook.com'));
    $subj = '[Stick It Out] ' . $source . ' | ' . $email;
    $body = "Name: {$name}\nEmail: {$email}\nSource: {$source}\nPlan: " . ($plan ?: 'none') . "\nTime: {$now}\n";
    @mail($to, $subj, $body, "From: {$from}\r\nContent-Type: text/plain; charset=UTF-8");
}

try {
    sio_forward_lead($cfg, $name, $email, $source, $plan);
} catch (Throwable $e) {
    // Still return ok: lead is on disk.
}

echo json_encode(['ok' => true, 'deduped' => $found]);

function sio_forward_lead(mixed $cfg, string $name, string $email, string $source, ?string $plan): void {
    if (!is_array($cfg)) return;
    $url = trim((string) ($cfg['ingestUrl'] ?? ''));
    $secret = trim((string) ($cfg['ingestSecret'] ?? ''));
    if ($url === '' || $secret === '') return;
    $payload = json_encode([
        'name' => $name,
        'email' => $email,
        'source' => $source,
        'plan' => $plan,
    ], JSON_UNESCAPED_SLASHES);
    if (!is_string($payload)) return;
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        if ($ch === false) return;
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/json',
                'Authorization: Bearer ' . $secret,
                'User-Agent: SIO-Capture/1.0',
            ],
            CURLOPT_POSTFIELDS => $payload,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 8,
        ]);
        curl_exec($ch);
        curl_close($ch);
        return;
    }
    $ctx = stream_context_create([
        'http' => [
            'method' => 'POST',
            'header' => "Content-Type: application/json\r\nAuthorization: Bearer {$secret}\r\nUser-Agent: SIO-Capture/1.0\r\n",
            'content' => $payload,
            'timeout' => 8,
            'ignore_errors' => true,
        ],
    ]);
    @file_get_contents($url, false, $ctx);
}
