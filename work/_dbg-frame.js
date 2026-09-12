const net = require('net');
const crypto = require('crypto');
const { spawn } = require('child_process');
const PORT = 8127;
const serverProc = spawn(process.execPath, ['outputs/gomoku-server.js', String(PORT)], {
  cwd: __dirname + '\\..',
  env: Object.assign({}, process.env, { HEARTBEAT_INTERVAL_MS: '500', HEARTBEAT_TIMEOUT_MS: '800', RECONNECT_WAIT_MS: '800', ROOM_STALE_MS: '600', CLEANUP_INTERVAL_MS: '200' }),
  stdio: ['ignore', 'pipe', 'pipe'],
});
serverProc.stdout.on('data', (d) => process.stdout.write('[server] ' + d));
serverProc.stderr.on('data', (d) => process.stderr.write('[server-err] ' + d));
const waitMs = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  await waitMs(600);
  const sock = net.connect(PORT, '127.0.0.1', () => {
    const key = crypto.randomBytes(16).toString('base64');
    sock.write('GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ' + key + '\r\nSec-WebSocket-Version: 13\r\n\r\n');
  });
  await waitMs(300);
  // 直接发送一个非法帧（未掩码文本帧），看服务器是否崩溃
  sock.write(Buffer.from([0x81, 0x01, 0x41]));   // 客户端帧未掩码
  await waitMs(500);
  sock.destroy();
  await waitMs(500);
  console.log('server alive:', serverProc.exitCode === null);
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(2); }).finally(() => setTimeout(() => serverProc.kill(), 200));
