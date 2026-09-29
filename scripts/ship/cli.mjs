#!/usr/bin/env node
import Client from 'ssh2-sftp-client';
import {
  assertDist,
  distPath,
  getSftpConfig,
  loadEnv,
  resolveWebRoot,
  uploadWithProgress,
  writeCaptureConfig,
} from './lib.mjs';

const target = 'production';

async function main() {
  loadEnv();
  assertDist();
  await writeCaptureConfig(distPath());

  const client = new Client();
  const cfg = getSftpConfig();
  console.log(`🔐 Connecting ${cfg.username}@${cfg.host}…`);
  await client.connect(cfg);
  try {
    const webRoot = await resolveWebRoot(client);
    const remote = webRoot === '/' ? '/' : webRoot;
    console.log(`🚀 Ship ${target} → ${remote || '/'} (stickitoutdrums.com)`);
    await uploadWithProgress(client, distPath(), remote);
    console.log('✅ Shipped');
    console.log('   Live: https://stickitoutdrums.com/');
    console.log('   Capture: https://stickitoutdrums.com/api/capture.php');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
