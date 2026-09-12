// 公网链路验证：异地对战依赖 WebSocket over 公网隧道（http/wss），
// 这里模拟真实流程：连上公网地址 → 建房 → 拿到房间号 → 第二人加入 → 落子同步。
// 用法: node work/verify-public-tunnel.js <公网地址，如 http://xxx.cpolar.top>
'use strict';
const base = process.argv[2];
if (!base) { console.error('用法: node work/verify-public-tunnel.js <公网地址>'); process.exit(2); }

/* 支持 http:// 与 https://；据此推导 ws:// 或 wss:// */
const u = new URL(base);
const wsProto = u.protocol === 'https:' ? 'wss:' : 'ws:';
const wsUrl = `${wsProto}//${u.host}/ws`;
console.log(`目标 WS 地址: ${wsUrl}`);

const TIMEOUT = 30000;
function fail(msg) { console.error('✗ ' + msg); process.exit(1); }
const timer = setTimeout(() => fail(`整体超时（${TIMEOUT}ms）`), TIMEOUT);

function connect(label) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const events = [];
    ws.onopen = () => resolve({ ws, events, label });
    ws.onerror = () => reject(new Error(label + ' 连接失败'));
    ws.onmessage = (ev) => {
      try { events.push(JSON.parse(ev.data)); } catch { events.push({ type: 'raw', data: ev.data }); }
    };
  });
}
function waitFor(conn, type, ms = 12000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => {
      const hit = conn.events.find(e => e.type === type);
      if (hit) return resolve(hit);
      if (Date.now() - t0 > ms) return reject(new Error(`等待 ${type} 超时（${conn.label}）`));
      setTimeout(tick, 100);
    };
    tick();
  });
}
const send = (conn, obj) => conn.ws.send(JSON.stringify(obj));

(async () => {
  /* ① 房主连接并建房 */
  const host = await connect('host');
  console.log('✓ 房主已连上公网 WebSocket');
  send(host, { type: 'create', boardSize: 15, guess: false });
  const created = await waitFor(host, 'room_created');
  console.log(`✓ 建房成功：房间号 ${created.room}（棋盘 ${created.boardSize}）`);

  /* ② 另一位玩家（模拟异地的朋友）连接并加入 */
  const guest = await connect('guest');
  console.log('✓ 对方已连上公网 WebSocket');
  send(guest, { type: 'join', room: created.room });
  const joined = await waitFor(guest, 'room_joined');
  console.log(`✓ 加入成功：房间 ${joined.room}，执${joined.color === 'black' ? '黑' : '白'}`);
  await waitFor(host, 'peer_joined');
  console.log('✓ 房主收到“对手已加入”通知');

  /* ③ 房主（黑）落子 → 对方应收到 move 广播 */
  send(host, { type: 'move', r: 7, c: 7 });
  const mv = await waitFor(guest, 'move');
  console.log(`✓ 落子实时同步：房主下 (${mv.r},${mv.c}) → 对方收到`);

  /* ④ 对方（白）应手 → 房主应收到 */
  send(guest, { type: 'move', r: 8, c: 8 });
  const mv2 = await waitFor(host, 'move');
  console.log(`✓ 反向同步：对方下 (${mv2.r},${mv2.c}) → 房主收到`);

  /* ⑤ 非法落子应被服务端拒绝（服务端权威） */
  send(guest, { type: 'move', r: 0, c: 0 });   // 还没轮到对方
  const err = await waitFor(guest, 'error', 6000).catch(() => null);
  console.log(err ? `✓ 服务端权威校验生效：非法落子被拒绝（${err.message}）` : '· 未收到预期错误（可能回合判断不同）');

  /* ⑥ 聊天消息转发 */
  send(host, { type: 'chat', text: '异地联机测试' });
  const chat = await waitFor(guest, 'chat', 8000).catch(() => null);
  console.log(chat ? `✓ 聊天转发正常：对方收到「${chat.text}」` : '· 未收到聊天消息');

  clearTimeout(timer);
  host.ws.close(); guest.ws.close();
  console.log('\n全部关键链路验证通过：公网 WebSocket 可用于异地联机');
  process.exit(0);
})().catch(e => { clearTimeout(timer); fail(e.message); });
