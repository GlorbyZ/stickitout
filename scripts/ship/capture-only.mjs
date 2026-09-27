import Client from 'ssh2-sftp-client';
import { mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { getSftpConfig, loadEnv, resolveWebRoot, writeCaptureConfig, distPath, REPO_ROOT } from './lib.mjs';

loadEnv();

const dist = distPath();
await mkdir(path.join(dist, 'api'), { recursive: true });
await mkdir(path.join(dist, 'data'), { recursive: true });
await copyFile(path.join(REPO_ROOT, 'public/api/capture.php'), path.join(dist, 'api/capture.php'));
await writeCaptureConfig(dist);

const client = new Client();
const cfg = getSftpConfig();
await client.connect(cfg);
try {
  const webRoot = await resolveWebRoot(client);
  const base = webRoot === '/' ? '' : webRoot.replace(/\/$/, '');
  for (const rel of ['api/capture.php', 'data/capture-config.php']) {
    const remotePath = `${base}/${rel}`.replace(/\/+/g, '/');
    const remoteDir = remotePath.slice(0, remotePath.lastIndexOf('/')) || '/';
    if (remoteDir && remoteDir !== '/') await client.mkdir(remoteDir, true);
    await client.fastPut(path.join(dist, rel), `${base}/${rel}`.replace(/\/+/g, '/'));
    console.log(`uploaded ${rel}`);
  }
} finally {
  await client.end();
}
console.log('Capture forwarder shipped');
