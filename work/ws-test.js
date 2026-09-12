'use strict';
/* ============================================================
 * 五子棋服务器协议层自动化测试（零依赖，原生 net + 手写 WebSocket 帧）
 * ------------------------------------------------------------
 * 覆盖：建房/加入/落子/判胜/悔棋语义、联机猜先、断线重连（快照恢复）、
 *       重连窗口超时、主动离开、再来一局、心跳保活、限频防刷、
 *       建房超时回收、静态文件服务。
 * 通过环境变量把服务器心跳/重连/清理参数缩短，保证测试快速稳定。
 * ============================================================ */
const net = require('net');
const crypto = require('crypto');
const { spawn } = require('child_process');

const PORT = 8123;
const TEST_ENV = Object.assign({}, process.env, {
  HEARTBEAT_INTERVAL_MS: '500',   // 心跳 ping 间隔 500ms
  HEARTBEAT_TIMEOUT_MS: '800',    // 800ms 无任何帧判定断线
  RECONNECT_WAIT_MS: '800',       // 重连窗口 800ms
  ROOM_STALE_MS: '600',           // 建房后 600ms 无人加入即回收
  CLEANUP_INTERVAL_MS: '200',     // 心跳/清理扫描周期 200ms
});
const serverProc = spawn(process.execPath, ['outputs/gomoku-server.js', String(PORT)], {
  cwd: __dirname + '\\..', env: TEST_ENV, stdio: ['ignore', 'pipe', 'pipe'],
});
serverProc.stdout.on('data', (d) => process.stdout.write('[server] ' + d));
serverProc.stderr.on('data', (d) => process.stderr.write('[server-err] ' + d));

const waitMs = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0;
function assert(cond, label) {
  if (!cond) throw new Error('断言失败: ' + label);
  passed++;
  console.log('  ✓ ' + label);
}

/* 客户端 → 服务器：掩码文本帧 */
function buildFrame(text) {
  const data = Buffer.from(text, 'utf8');
  const mask = crypto.randomBytes(4);
  const masked = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) masked[i] = data[i] ^ mask[i % 4];
  let header;
  if (data.length < 126) {
    header = Buffer.from([0x81, 0x80 | data.length]);
  } else {
    header = Buffer.alloc(4);
    header[0] = 0x81; header[1] = 0x80 | 126;
    header.writeUInt16BE(data.length, 2);
  }
  return Buffer.concat([header, mask, masked]);
}

/* 客户端回 pong（掩码可选；回给服务器无需掩码） */
function buildPong() { return Buffer.from([0x8A, 0x00]); }

/* 服务器 → 客户端：无掩码帧解析，返回 {opcode, consumed, text} 或 null（不完整） */
function parseServerFrame(buf) {
  if (buf.length < 2) return null;
  const b0 = buf[0], b1 = buf[1];
  const opcode = b0 & 0x0f;
  let len = b1 & 0x7f;
  let off = 2;
  if (len === 126) {
    if (buf.length < 4) return null;
    len = buf.readUInt16BE(2); off = 4;
  } else if (len === 127) {
    if (buf.length < 10) return null;
    len = Number(buf.readBigUInt64BE(2)); off = 10;
  }
  if (buf.length < off + len) return null;
  const payload = buf.subarray(off, off + len);
  return { opcode, consumed: off + len, text: opcode === 0x1 ? payload.toString('utf8') : null };
}

class WsClient {
  constructor(name) {
    this.name = name;
    this.messages = [];
    this.waiters = [];
    this.buffer = Buffer.alloc(0);
    this.socket = null;
    this.closed = false;   // 连接是否已被关闭/销毁（心跳、限频测试用）
  }
  connect() {
    return new Promise((resolve, reject) => {
      const sock = net.connect(PORT, '127.0.0.1', () => {
        const key = crypto.randomBytes(16).toString('base64');
        sock.write(
          'GET /ws HTTP/1.1\r\nHost: 127.0.0.1:' + PORT + '\r\n' +
          'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
          'Sec-WebSocket-Key: ' + key + '\r\nSec-WebSocket-Version: 13\r\n\r\n'
        );
      });
      this.socket = sock;
      let handshaken = false;
      sock.on('data', (chunk) => {
        if (!handshaken) {
          const head = chunk.toString('latin1');
          const idx = head.indexOf('\r\n\r\n');
          if (idx === -1) return;
          if (!head.startsWith('HTTP/1.1 101')) return reject(new Error('握手失败: ' + head.split('\r\n')[0]));
          handshaken = true;
          chunk = chunk.subarray(idx + 4);
        }
        this.buffer = Buffer.concat([this.buffer, chunk]);
        while (true) {
          const frame = parseServerFrame(this.buffer);
          if (!frame) break;
          this.buffer = this.buffer.subarray(frame.consumed);
          if (frame.opcode === 0x1) this._push(JSON.parse(frame.text));
          else if (frame.opcode === 0x9) { try { sock.write(buildPong()); } catch (e) { /* 已断开 */ } }  // 自动回 pong 保活
        }
      });
      sock.on('error', reject);
      sock.on('close', () => { this.closed = true; this._push(null); });
      const timer = setInterval(() => {
        if (handshaken) { clearInterval(timer); resolve(); }
      }, 10);
      setTimeout(() => { clearInterval(timer); }, 3000);
    });
  }
  _push(msg) {
    this.messages.push(msg);
    for (const w of this.waiters) w(msg);
  }
  send(obj) { try { this.socket.write(buildFrame(JSON.stringify(obj))); } catch (e) { /* 已断开 */ } }
  close() { try { this.socket.end(); } catch (e) { /* ignore */ } }
  destroy() { try { this.socket.destroy(); } catch (e) { /* ignore */ } }
  async waitFor(type, timeout = 4000) {
    const idx = this.messages.findIndex((m) => m && m.type === type);
    if (idx >= 0) return this.messages.splice(idx, 1)[0];
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(h), 1);
        reject(new Error(this.name + ' 等待 ' + type + ' 超时'));
      }, timeout);
      const h = (msg) => {
        if (msg && msg.type === type) {
          clearTimeout(timer);
          this.waiters.splice(this.waiters.indexOf(h), 1);
          const i = this.messages.indexOf(msg);
          if (i >= 0) this.messages.splice(i, 1);
          resolve(msg);
        } else if (msg === null) {
          clearTimeout(timer);
          reject(new Error(this.name + ' 在等待 ' + type + ' 时连接关闭'));
        }
      };
      this.waiters.push(h);
    });
  }
  async waitClosed(timeout = 4000) {
    if (this.closed) return;
    const t0 = Date.now();
    while (!this.closed && Date.now() - t0 < timeout) await waitMs(50);
    return this.closed;
  }
}

(async () => {
  await waitMs(500);

  console.log('== 房间创建与加入 ==');
  const A = new WsClient('A'); await A.connect();
  const B = new WsClient('B'); await B.connect();
  const C = new WsClient('C'); await C.connect();

  A.send({ type: 'create' });
  const created = await A.waitFor('room_created');
  assert(/^[A-Z0-9]{5}$/.test(created.room), '房间号为 5 位字母数字: ' + created.room);
  assert(created.color === 'black', '房主执黑');
  assert(typeof created.token === 'string' && created.token.length >= 16, '房主获得重连 token');
  const roomCode = created.room;

  B.send({ type: 'join', room: roomCode });
  const joined = await B.waitFor('room_joined');
  assert(joined.color === 'white', '加入者执白');
  assert(typeof joined.token === 'string' && joined.token.length >= 16, '加入者获得重连 token');
  await A.waitFor('peer_joined');

  console.log('== 落子同步与轮次校验 ==');
  A.send({ type: 'move', r: 0, c: 0 });
  const mvA = await A.waitFor('move');
  const mvB = await B.waitFor('move');
  assert(mvA.r === 0 && mvA.c === 0 && mvB.r === 0 && mvB.c === 0, '双方都收到 move(0,0)');
  assert(mvA.version === 1 && mvB.version === 1, 'move 消息带版本号 version=1');

  A.send({ type: 'move', r: 5, c: 5 });
  const errTurn = await A.waitFor('error');
  assert(/轮到你/.test(errTurn.message), '非本方回合被拒绝: ' + errTurn.message);

  console.log('== 黑棋连五获胜 ==');
  const seq = [
    ['B', [1, 0]], ['A', [0, 1]], ['B', [1, 1]], ['A', [0, 2]],
    ['B', [1, 2]], ['A', [0, 3]], ['B', [1, 3]], ['A', [0, 4]],
  ];
  for (const [who, [r, c]] of seq) {
    (who === 'A' ? A : B).send({ type: 'move', r, c });
    await A.waitFor('move');
    await B.waitFor('move');
  }
  const goA = await A.waitFor('game_over');
  const goB = await B.waitFor('game_over');
  assert(goA.winner === 'black' && goB.winner === 'black', '双方都判定黑棋获胜');

  B.send({ type: 'move', r: 8, c: 8 });
  const errOver = await B.waitFor('error');
  assert(/结束/.test(errOver.message), '终局后落子被拒绝: ' + errOver.message);

  A.send({ type: 'create' });
  const errInRoom = await A.waitFor('error');
  assert(/已在房间/.test(errInRoom.message), '已在房间时再次创建被拒绝');

  const D = new WsClient('D'); await D.connect();
  D.send({ type: 'join', room: roomCode });
  const errEnd = await D.waitFor('error');
  assert(/已满/.test(errEnd.message), '终局后房间仍满员，加入被拒绝: ' + errEnd.message);
  D.send({ type: 'join', room: 'ZZZZZ' });
  const errNoRoom = await D.waitFor('error');
  assert(/不存在/.test(errNoRoom.message), '加入不存在的房间被拒绝');
  // 对方（B）主动离开 → 房主收到 guest_left（房间保留）；新对手 D 重新加入即自动重开
  B.send({ type: 'leave' });
  const guestLeftAfterLeave = await A.waitFor('guest_left', 3000);
  assert(guestLeftAfterLeave.type === 'guest_left', '对方主动离开后房主收到 guest_left（房间保留）');
  D.send({ type: 'join', room: roomCode });
  const rejoined = await D.waitFor('room_joined');
  assert(rejoined.color === 'white', '新对手加入成功（终局后自动重开一局）');
  await A.waitFor('peer_joined');
  assert(true, '房主收到新对手加入通知 peer_joined');
  D.close(); A.close(); B.close();

  console.log('== 占位校验与满员校验 ==');
  const E = new WsClient('E'); await E.connect();
  E.send({ type: 'create' });
  const created2 = await E.waitFor('room_created');
  const F = new WsClient('F'); await F.connect();
  F.send({ type: 'join', room: created2.room });
  const fJoined = await F.waitFor('room_joined');
  await E.waitFor('peer_joined');

  E.send({ type: 'move', r: 3, c: 3 });
  await E.waitFor('move'); await F.waitFor('move');
  F.send({ type: 'move', r: 3, c: 3 });
  const errOcc = await F.waitFor('error');
  assert(/已有棋子/.test(errOcc.message), '占位落子被拒绝');

  const G = new WsClient('G'); await G.connect();
  G.send({ type: 'join', room: created2.room });
  const errFull = await G.waitFor('error');
  assert(/已满/.test(errFull.message), '满员房间被拒绝加入');
  G.close();
  await waitMs(100);   // 等服务器清理完 G 的会话，避免干扰后续计数

  console.log('== 断线重连：快照恢复与对端通知 ==');
  // F 非主动断开（直接 destroy 模拟断网/刷新）→ E 收到 peer_reconnecting
  F.destroy();
  await E.waitFor('peer_reconnecting');
  assert(true, '非主动断开时对端收到 peer_reconnecting');
  // 用 F 的 token 重连 → 收到权威快照，E 收到 peer_reconnected
  const F2 = new WsClient('F2'); await F2.connect();
  F2.send({ type: 'reconnect', room: created2.room, token: fJoined.token });
  const snap = await F2.waitFor('room_snapshot');
  assert(Array.isArray(snap.board) && snap.board[3][3] === 1, '快照恢复棋盘（E 的黑子在 (3,3)）');
  assert(snap.turn === 1, '快照回合为白（F 刚下完）');
  assert(snap.color === 'white', '快照带角色 color=white（F2 是加入者）');
  assert(snap.version === 1 && snap.lastMove[0] === 3 && snap.lastMove[1] === 3, '快照带版本号与最后一步 (version=1, [3,3])');
  await E.waitFor('peer_reconnected');
  assert(true, '对端收到 peer_reconnected');
  // 重连后继续对弈：快照显示轮到白（F2），由 F2 落子，E 同步收到
  F2.send({ type: 'move', r: 4, c: 3 });
  const mvE = await E.waitFor('move');
  const mvF2 = await F2.waitFor('move');
  assert(mvE.r === 4 && mvE.c === 3 && mvF2.r === 4 && mvF2.c === 3, '重连后双方继续对弈同步');

  // 无效 token 重连被拒
  const H = new WsClient('H'); await H.connect();
  H.send({ type: 'reconnect', room: created2.room, token: 'deadbeef' });
  const errToken = await H.waitFor('error');
  assert(/凭证无效/.test(errToken.message), '无效 token 重连被拒绝');
  // 原连接仍在线时重连被拒（用 E 的 token 模拟“重复登录”）
  H.send({ type: 'reconnect', room: created2.room, token: created2.token });
  const errOnline = await H.waitFor('error');
  assert(/仍在线/.test(errOnline.message), '原连接仍在线时重连被拒绝');
  H.close();

  console.log('== 重连窗口超时 → 正式离开 ==');
  F2.destroy();                                   // 再次非主动断开
  await E.waitFor('peer_reconnecting');
  const guestLeftAfterWait = await E.waitFor('guest_left', 4000);   // 窗口 800ms + 清理周期后触发
  assert(guestLeftAfterWait.type === 'guest_left', '重连窗口超时后房主收到 guest_left（房间保留可重新邀请）');
  // 房间保留：新 guest 可直接加入（棋盘有棋子 → 收到快照恢复局面）
  const M2 = new WsClient('M2'); await M2.connect();
  M2.send({ type: 'join', room: created2.room });
  await M2.waitFor('room_joined');
  await E.waitFor('peer_joined');
  const snapRejoin = await M2.waitFor('room_snapshot');
  assert(snapRejoin.board[3][3] === 1 && snapRejoin.color === 'white', '中途加入收到快照恢复局面（含已有棋子）');
  M2.close(); E.close();

  console.log('== 主动离开立即通知 ==');
  const I = new WsClient('I'); await I.connect();
  const J = new WsClient('J'); await J.connect();
  I.send({ type: 'create' });
  const created3 = await I.waitFor('room_created');
  J.send({ type: 'join', room: created3.room });
  await J.waitFor('room_joined');
  await I.waitFor('peer_joined');
  J.send({ type: 'leave' });                      // 主动离开
  const guestLeftImmediate = await I.waitFor('guest_left', 3000);
  assert(guestLeftImmediate.type === 'guest_left', '主动离开立即通知房主 guest_left（房间保留）');
  // 房主仍在：新对手可重新加入
  const I2 = new WsClient('I2'); await I2.connect();
  I2.send({ type: 'join', room: created3.room });
  await I2.waitFor('room_joined');
  await I.waitFor('peer_joined');
  assert(true, '对方离开后新对手可直接加入');
  I2.close();
  I.close();

  console.log('== 再来一局（rematch） ==');
  const K = new WsClient('K'); await K.connect();
  const L = new WsClient('L'); await L.connect();
  K.send({ type: 'create' });
  const created4 = await K.waitFor('room_created');
  L.send({ type: 'join', room: created4.room });
  await L.waitFor('room_joined');
  await K.waitFor('peer_joined');
  // 对局未结束时 rematch 被拒
  K.send({ type: 'rematch' });
  const errRematchEarly = await K.waitFor('error');
  assert(/未结束/.test(errRematchEarly.message), '对局未结束时 rematch 被拒绝');
  // 黑棋（K）连五获胜
  const seq2 = [
    ['K', [10, 0]], ['L', [11, 0]], ['K', [10, 1]], ['L', [11, 1]],
    ['K', [10, 2]], ['L', [11, 2]], ['K', [10, 3]], ['L', [11, 3]],
    ['K', [10, 4]],
  ];
  for (const [who, [r, c]] of seq2) {
    (who === 'K' ? K : L).send({ type: 'move', r, c });
    await K.waitFor('move');
    await L.waitFor('move');
  }
  await K.waitFor('game_over');
  await L.waitFor('game_over');
  // K 发起 rematch → 双方收到 reset
  K.send({ type: 'rematch' });
  await K.waitFor('reset');
  await L.waitFor('reset');
  assert(true, '终局后 rematch 双方收到 reset');
  // 角色保持：K 仍是黑（先手），L 仍是白
  K.send({ type: 'move', r: 7, c: 7 });
  const mvK2 = await K.waitFor('move');
  assert(mvK2.r === 7 && mvK2.c === 7, '重开后黑方（原房主 K）仍可先手落子');
  await L.waitFor('move');
  L.send({ type: 'move', r: 7, c: 8 });
  await K.waitFor('move');
  await L.waitFor('move');
  assert(true, '重开后双方继续对弈');
  K.close(); L.close();

  console.log('== 心跳保活与断线判定 ==');
  // 正常客户端自动回 pong → 多个心跳周期后仍在线
  const M = new WsClient('M'); await M.connect();
  await waitMs(2500);                              // 约 5 个心跳周期
  assert(!M.closed, '自动回 pong 的客户端保持在线（心跳保活）');
  // 裸 socket 不回 pong → 超时被服务器销毁
  const raw = net.connect(PORT, '127.0.0.1', () => {
    const key = crypto.randomBytes(16).toString('base64');
    raw.write(
      'GET /ws HTTP/1.1\r\nHost: 127.0.0.1:' + PORT + '\r\n' +
      'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
      'Sec-WebSocket-Key: ' + key + '\r\nSec-WebSocket-Version: 13\r\n\r\n'
    );
  });
  let rawClosed = false;
  raw.on('data', () => { /* 消费数据（真实 WebSocket 客户端总会读取数据），否则暂停模式不会及时收到 close */ });
  raw.on('close', () => { rawClosed = true; });
  await waitMs(2500);
  assert(rawClosed, '不回 pong 的客户端在心跳超时后被销毁');
  M.close();

  console.log('== 限频防刷 ==');
  const N = new WsClient('N'); await N.connect();
  for (let i = 0; i < 21; i++) N.send({ type: 'create' });   // 1 秒内超 20 条
  const nClosed = await N.waitClosed(3000);
  assert(nClosed, '每秒消息数超过上限的连接被断开');
  // 服务器未崩溃：仍可正常建房
  const O = new WsClient('O'); await O.connect();
  O.send({ type: 'create' });
  const created5 = await O.waitFor('room_created');
  assert(/^[A-Z0-9]{5}$/.test(created5.room), '限频断开后服务器仍正常服务');
  O.close();

  console.log('== 建房超时无人加入 → 回收 ==');
  const P = new WsClient('P'); await P.connect();
  P.send({ type: 'create' });
  const created6 = await P.waitFor('room_created');
  const staleErr = await P.waitFor('error', 4000);           // 600ms 回收时限 + 200ms 周期
  assert(/等待超时/.test(staleErr.message), '建房后无人加入，房主收到回收提示: ' + staleErr.message);
  const Q = new WsClient('Q'); await Q.connect();
  Q.send({ type: 'join', room: created6.room });
  const errStaleGone = await Q.waitFor('error');
  assert(/不存在/.test(errStaleGone.message), '回收后房间不可再加入');
  Q.close(); P.close();

  console.log('== 房间级棋盘大小（13/15/19） ==');
  const R1 = new WsClient('R1'); await R1.connect();
  R1.send({ type: 'create', boardSize: 13 });
  const c13 = await R1.waitFor('room_created');
  assert(c13.boardSize === 13, 'create 携带 boardSize=13 生效');
  const R2 = new WsClient('R2'); await R2.connect();
  R2.send({ type: 'join', room: c13.room });
  const j13 = await R2.waitFor('room_joined');
  assert(j13.boardSize === 13, '加入者收到房间 boardSize=13');
  await R1.waitFor('peer_joined');
  R1.send({ type: 'move', r: 5, c: 5 });           // 合法落子
  await R1.waitFor('move'); await R2.waitFor('move');
  R2.send({ type: 'move', r: 13, c: 13 });         // 13 路棋盘越界（轮到白棋）
  const errOob = await R2.waitFor('error');
  assert(/超出棋盘范围/.test(errOob.message), '13 路棋盘越界落子被拒: ' + errOob.message);
  R2.destroy();                                     // 断线进入重连窗口
  await R1.waitFor('peer_reconnecting');
  const R3 = new WsClient('R3'); await R3.connect();
  R3.send({ type: 'reconnect', room: c13.room, token: j13.token });
  const snap13 = await R3.waitFor('room_snapshot');
  assert(snap13.boardSize === 13 && snap13.board.length === 13, '重连快照带 boardSize=13 与对应棋盘');
  R3.send({ type: 'leave' });
  
  const R4 = new WsClient('R4'); await R4.connect();
  R4.send({ type: 'create', boardSize: 99 });      // 非法大小
  const cDflt = await R4.waitFor('room_created');
  assert(cDflt.boardSize === 19, '非法 boardSize 回退默认 19');
  R1.close(); R3.close(); R4.close();

  console.log('== 聊天广播（双方实时交流） ==');
  const S1 = new WsClient('S1'); await S1.connect();
  S1.send({ type: 'create' });
  const sRoom = await S1.waitFor('room_created');
  const S2 = new WsClient('S2'); await S2.connect();
  S2.send({ type: 'join', room: sRoom.room });
  await S2.waitFor('room_joined');
  await S1.waitFor('peer_joined');
  S1.send({ type: 'chat', text: '  你好！  ' });
  const c1 = await S1.waitFor('chat');
  const c2 = await S2.waitFor('chat');
  assert(c1.text === '你好！' && c1.from === 'host' && c1.color === 'black', '房主聊天广播且去除首尾空白');
  assert(c2.text === '你好！' && c2.from === 'host', '加入者收到房主聊天消息');
  S2.send({ type: 'chat', text: '收到' });
  const c3 = await S1.waitFor('chat');
  assert(c3.from === 'guest' && c3.color === 'white' && c3.text === '收到', '加入者消息以 guest 身份广播');
  S1.send({ type: 'chat', text: 'X'.repeat(500) }); // 超长消息
  const c4 = await S1.waitFor('chat');
  assert(c4.text.length === 200, '聊天消息截断到 200 字符');
  S1.close(); S2.close();

  console.log('== 昵称同步（随时可改，广播对方） ==');
  const T1 = new WsClient('T1'); await T1.connect();
  T1.send({ type: 'create' });
  const tRoom = await T1.waitFor('room_created');
  const T2 = new WsClient('T2'); await T2.connect();
  T2.send({ type: 'join', room: tRoom.room });
  await T2.waitFor('room_joined');
  await T1.waitFor('peer_joined');
  T1.send({ type: 'nickname', name: '  小明  ' });
  const n1 = await T1.waitFor('nickname_update');
  const n2 = await T2.waitFor('nickname_update');
  assert(n1.from === 'host' && n1.name === '小明', '房主昵称去除空白后广播');
  assert(n2.name === '小明', '加入者收到房主昵称');
  T2.send({ type: 'nickname', name: 'X'.repeat(50) });
  const n3 = await T1.waitFor('nickname_update');
  assert(n3.from === 'guest' && n3.name.length === 12, '昵称截断到 12 字符');
  T1.close(); T2.close();

  console.log('== 联机中修改棋盘大小（set_board_size） ==');
  const U1 = new WsClient('U1'); await U1.connect();
  U1.send({ type: 'create' });
  const uRoom = await U1.waitFor('room_created');
  const U2 = new WsClient('U2'); await U2.connect();
  U2.send({ type: 'join', room: uRoom.room });
  await U2.waitFor('room_joined');
  await U1.waitFor('peer_joined');
  // 非房主修改被拒
  U2.send({ type: 'set_board_size', size: 15 });
  const errGuestSize = await U2.waitFor('error');
  assert(/仅房主/.test(errGuestSize.message), '非房主修改棋盘大小被拒绝');
  // 房主 + 未开局：修改成功并广播
  U1.send({ type: 'set_board_size', size: 15 });
  const bsc1 = await U1.waitFor('board_size_changed');
  const bsc2 = await U2.waitFor('board_size_changed');
  assert(bsc1.boardSize === 15 && bsc2.boardSize === 15, '房主修改棋盘大小为 15 并广播双方');
  // 对局中房主仍可修改：改大小 = 双方清空棋盘重开一局
  U1.send({ type: 'move', r: 7, c: 7 });
  await U1.waitFor('move'); await U2.waitFor('move');
  U1.send({ type: 'set_board_size', size: 13 });
  const bsc3 = await U1.waitFor('board_size_changed');
  const bsc4 = await U2.waitFor('board_size_changed');
  assert(bsc3.boardSize === 13 && bsc4.boardSize === 13, '对局中房主修改棋盘大小为 13 并广播双方');
  U1.send({ type: 'move', r: 6, c: 6 });         // 重开后黑方（房主）先手
  const mvAfterSize = await U1.waitFor('move');
  assert(mvAfterSize.r === 6 && mvAfterSize.c === 6, '改大小后棋盘清空重开，黑方（房主）可先手落子');
  U1.close(); U2.close();

  console.log('== 房主重置房间（reset_room，等待新对手） ==');
  const V1 = new WsClient('V1'); await V1.connect();
  V1.send({ type: 'create' });
  const vRoom = await V1.waitFor('room_created');
  const V2 = new WsClient('V2'); await V2.connect();
  V2.send({ type: 'join', room: vRoom.room });
  await V2.waitFor('room_joined');
  await V1.waitFor('peer_joined');
  V1.send({ type: 'reset_room' });                 // 对方在线时拒绝
  const errResetBusy = await V1.waitFor('error');
  assert(/仍在线/.test(errResetBusy.message), '对方在线时 reset_room 被拒绝');
  V1.send({ type: 'move', r: 1, c: 1 });           // 双方在线时落子（制造“棋盘有子”）
  await V1.waitFor('move'); await V2.waitFor('move');
  V2.send({ type: 'leave' });
  await V1.waitFor('guest_left');
  V1.send({ type: 'reset_room' });                 // 对方已走，允许重置
  const rst = await V1.waitFor('reset');
  assert(rst.type === 'reset', '房主重置房间成功（清空棋盘等待新对手）');
  V1.send({ type: 'move', r: 1, c: 1 });           // 单人无法落子（服务器要求双方在线）
  const errWaitGuest = await V1.waitFor('error');
  assert(/等待对手/.test(errWaitGuest.message), '重置后单人落子被拒（等待新对手）');
  const V3 = new WsClient('V3'); await V3.connect();
  V3.send({ type: 'join', room: vRoom.room });     // 新对手加入
  await V3.waitFor('room_joined');
  await V1.waitFor('peer_joined');
  V1.send({ type: 'move', r: 1, c: 1 });           // 重开后黑棋重新落子（棋盘已清空）
  const mvAfterReset = await V1.waitFor('move');
  assert(mvAfterReset.r === 1 && mvAfterReset.c === 1, '重置后棋盘清空，可重新对弈');
  V3.close(); V1.close();


  console.log('== 联机公平猜先（服务器权威掷币，颜色与角色解耦） ==');
  // ① 开启猜先：双方就位后先猜先再开局
  const G1 = new WsClient('G1'); await G1.connect();
  G1.send({ type: 'create', guess: true });
  const gc1 = await G1.waitFor('room_created');
  assert(gc1.guessPending === true, '开启猜先的建房响应带 guessPending=true');
  const G2 = new WsClient('G2'); await G2.connect();
  G2.send({ type: 'join', room: gc1.room });
  const gj1 = await G2.waitFor('room_joined');
  assert(gj1.guessPending === true, '加入者收到 guessPending=true');
  const gs1 = await G1.waitFor('guess_start');
  const gs2 = await G2.waitFor('guess_start');
  assert(gs1.selector === gs2.selector && (gs1.selector === 'host' || gs1.selector === 'guest'), '双方收到同一个 guess_start.selector=' + gs1.selector);
  // ② 猜先完成前禁止落子
  G1.send({ type: 'move', r: 0, c: 0 });
  const errGuess = await G1.waitFor('error');
  assert(/猜先/.test(errGuess.message), '猜先未完成前落子被拒: ' + errGuess.message);
  // ③ 只有先选方可以猜硬币
  const selectorClient = gs1.selector === 'host' ? G1 : G2;
  const otherClient = gs1.selector === 'host' ? G2 : G1;
  otherClient.send({ type: 'guess_pick', side: 'heads' });
  const errNotSel = await otherClient.waitFor('error');
  assert(/轮到你/.test(errNotSel.message), '非先选方猜硬币被拒: ' + errNotSel.message);
  // ④ 先选方猜硬币：结果由服务器揭晓（猜对/猜错各 50%，两种结果都必须能走到 color_assigned）
  selectorClient.send({ type: 'guess_pick', side: 'heads' });
  const gwon1 = await G1.waitFor('guess_won');
  const gwon2 = await G2.waitFor('guess_won');
  assert(gwon1.winner === gwon2.winner && (gwon1.winner === 'host' || gwon1.winner === 'guest'), '双方收到同一个 guess_won.winner=' + gwon1.winner);
  // ⑤ 只有赢家能选执子颜色
  const winnerClient = gwon1.winner === 'host' ? G1 : G2;
  const loserClient = gwon1.winner === 'host' ? G2 : G1;
  loserClient.send({ type: 'guess_color', color: 'white' });
  const errNotWin = await loserClient.waitFor('error');
  assert(/赢家/.test(errNotWin.message), '非赢家选色被拒: ' + errNotWin.message);
  winnerClient.send({ type: 'guess_color', color: 'black' });   // 赢家选执黑先行
  const ca1 = await G1.waitFor('color_assigned');
  const ca2 = await G2.waitFor('color_assigned');
  const hostBlack = ca1.hostColor === 'black' && ca1.guestColor === 'white';
  const guestBlack = ca1.hostColor === 'white' && ca1.guestColor === 'black';
  assert(hostBlack || guestBlack, 'color_assigned 颜色互补且由赢家决定');
  assert(JSON.stringify(ca1) === JSON.stringify(ca2), '双方收到一致的 color_assigned');
  // ⑥ 颜色与角色解耦：执黑者先手落子，执白者第二手
  const blackClient = ca1.hostColor === 'black' ? G1 : G2;
  const whiteClient = ca1.hostColor === 'black' ? G2 : G1;
  blackClient.send({ type: 'move', r: 7, c: 7 });
  await G1.waitFor('move');
  await G2.waitFor('move');
  whiteClient.send({ type: 'move', r: 8, c: 8 });
  await G1.waitFor('move');
  await G2.waitFor('move');
  assert(true, '猜先后执黑者先手、执白者第二手，落子正常');
  G1.close(); G2.close();

  // ⑦ 跳过猜先 → 默认房主执黑（旧行为兼容）
  const G3 = new WsClient('G3'); await G3.connect();
  G3.send({ type: 'create', guess: true });
  const gc3 = await G3.waitFor('room_created');
  const G4 = new WsClient('G4'); await G4.connect();
  G4.send({ type: 'join', room: gc3.room });
  await G4.waitFor('room_joined');
  const gs3 = await G3.waitFor('guess_start');
  await G4.waitFor('guess_start');
  (gs3.selector === 'host' ? G3 : G4).send({ type: 'guess_skip' });
  const ca3 = await G3.waitFor('color_assigned');
  await G4.waitFor('color_assigned');
  assert(ca3.hostColor === 'black' && ca3.guestColor === 'white', '跳过猜先后默认房主执黑');
  G3.close(); G4.close();

  // ⑧ 不开启猜先：保持旧行为（固定黑白、无 guess_start）
  const G5 = new WsClient('G5'); await G5.connect();
  G5.send({ type: 'create' });
  const gc5 = await G5.waitFor('room_created');
  assert(gc5.guessPending === false, '未开启猜先：room_created.guessPending=false');
  const G6 = new WsClient('G6'); await G6.connect();
  G6.send({ type: 'join', room: gc5.room });
  const gj6 = await G6.waitFor('room_joined');
  assert(gj6.guessPending === false && gj6.color === 'white', '未开启猜先：加入者 guessPending=false 且执白');
  await waitMs(300);
  assert(!G5.messages.some((m) => m && m.type === 'guess_start'), '未开启猜先：不会触发 guess_start');
  G5.close(); G6.close();

  // ⑨ 猜先中途断线重连：服务器补发 guess_start，流程可继续
  const G7 = new WsClient('G7'); await G7.connect();
  G7.send({ type: 'create', guess: true });
  const gc7 = await G7.waitFor('room_created');
  const G8 = new WsClient('G8'); await G8.connect();
  G8.send({ type: 'join', room: gc7.room });
  const gj8 = await G8.waitFor('room_joined');
  const gs7 = await G7.waitFor('guess_start');
  await G8.waitFor('guess_start');
  G8.destroy();                                   // 模拟猜先中途断线（非主动断开 → 进入重连窗口）
  await waitMs(400);
  const G9 = new WsClient('G9'); await G9.connect();
  G9.send({ type: 'reconnect', room: gc7.room, token: gj8.token });
  const snap9 = await G9.waitFor('room_snapshot');
  assert(snap9.role === 'guest' && snap9.board.length > 0, '猜先中途重连：快照带角色 role=guest');
  const gs9 = await G9.waitFor('guess_start');
  assert(gs9.selector === gs7.selector, '猜先中途重连：补发 guess_start 且 selector 一致');
  G7.close(); G9.close();

  console.log('== 通话信令转发（call_offer/answer/ice/end） ==');
  const W1 = new WsClient('W1'); await W1.connect();
  W1.send({ type: 'create' });
  const wRoom = await W1.waitFor('room_created');
  const W2 = new WsClient('W2'); await W2.connect();
  W2.send({ type: 'join', room: wRoom.room });
  await W2.waitFor('room_joined');
  await W1.waitFor('peer_joined');
  W1.send({ type: 'call_offer', mode: 'video', sdp: 'SDP-OFFER-123' });
  const of2 = await W2.waitFor('call_offer');
  assert(of2.from === 'host' && of2.sdp === 'SDP-OFFER-123' && of2.mode === 'video', 'call_offer 只转发给对端且带发送方角色');
  W2.send({ type: 'call_answer', sdp: 'SDP-ANSWER-456' });
  const an1 = await W1.waitFor('call_answer');
  assert(an1.from === 'guest' && an1.sdp === 'SDP-ANSWER-456', 'call_answer 带 guest 角色转发');
  W1.send({ type: 'call_ice', candidate: { sdp: 'candidate:1', sdpMLineIndex: 0 } });
  const ice1 = await W2.waitFor('call_ice');
  assert(ice1.from === 'host' && ice1.candidate.sdp === 'candidate:1', 'call_ice 转发 ICE 候选');
  W1.send({ type: 'call_end' });
  const end1 = await W2.waitFor('call_end');
  assert(end1.type === 'call_end' && end1.from === 'host', 'call_end 挂断转发');
  W2.send({ type: 'call_reject' });
  const rej = await W1.waitFor('call_reject');
  assert(rej.from === 'guest', 'call_reject 拒绝转发');
  W2.send({ type: 'leave' });
  await W1.waitFor('guest_left');
  W1.send({ type: 'call_offer', mode: 'audio', sdp: 'x' });   // 对端不在线
  const errNoPeer = await W1.waitFor('error');
  assert(/不在线/.test(errNoPeer.message), '对端不在线时通话信令被拒绝');
  W1.close();

  console.log('== 静态文件服务 ==');
  const r1 = await fetch('http://127.0.0.1:' + PORT + '/');
  const t1 = await r1.text();
  assert(r1.status === 200 && t1.includes('五子棋'), '首页 200 且包含标题');
  const r2 = await fetch('http://127.0.0.1:' + PORT + '/games/chess.js');
  assert(r2.status === 200, 'games/chess.js 可访问');
  // fetch 会自动规范化 URL，这里用原生 http.request 发送原始路径来测目录穿越
  const r3 = await new Promise((resolve, reject) => {
    const req = require('http').request(
      { host: '127.0.0.1', port: PORT, path: '/../gomoku.html', method: 'GET' },
      (res) => { res.resume(); resolve(res); }
    );
    req.on('error', reject);
    req.end();
  });
  assert(r3.statusCode === 403, '目录穿越被拒绝 (403)');
  const r4 = await fetch('http://127.0.0.1:' + PORT + '/nope.html');
  assert(r4.status === 404, '不存在文件返回 404');

  console.log('\n全部协议测试通过 ✓（共 ' + passed + ' 项断言）');
  for (const c of [A, B, C, D, E, F, G, F2, H, I, J, K, L, M, N, O, P, Q]) { if (c) c.close(); }
})().catch((e) => {
  console.error('\n测试失败: ' + e.message);
  process.exitCode = 1;
}).finally(() => {
  setTimeout(() => { serverProc.kill(); process.exit(); }, 300);
});
