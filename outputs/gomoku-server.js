#!/usr/bin/env node
/* ============================================================
 * 五子棋在线对战服务器（零依赖，原生 Node 实现）
 * ------------------------------------------------------------
 * 功能：
 *   1) 静态文件服务：把本文件所在目录作为网站根目录，直接访问
 *      http://127.0.0.1:8123/ 即可打开五子棋页面（含 games/ 子目录）；
 *   2) WebSocket 服务：路径 /ws，负责“创建房间 / 加入房间 / 实时对弈”。
 *
 * 启动方式：
 *   node gomoku-server.js [端口]      （默认 8123，也支持 PORT 环境变量）
 *
 * 联机协议（JSON 消息）：
 *   客户端 → 服务器：
 *     {type:'create', guess}          创建房间（guess=true 时开局猜先公平定执子颜色）
 *     {type:'join', room:'AB12C'}     加入指定房间（执白）
 *     {type:'reconnect', room, token} 用建房/加入时下发的凭证断线重连（恢复局面）
 *     {type:'move', r, c}             落子（坐标从 0 开始）
 *     {type:'rematch'}（同 reset）    终局后双方重开一局
 *     {type:'leave'}                  主动离开（立即作废对局，不走重连窗口）
 *     {type:'nickname', name}         设置昵称（≤12 字符），广播给对方
 *     {type:'set_board_size', size}   仅房主修改棋盘大小（13/15/19，改大小=清空重开）
 *     {type:'guess_pick', side}       猜先：先选方选硬币面 heads/tails
 *     {type:'guess_color', color}     猜先：赢家选执黑/执白
 *     {type:'guess_skip'}             猜先：先选方跳过，默认房主执黑
 *     {type:'reset_room'}             仅房主：对方不在线时清空棋盘等待新对手
 *     {type:'call_offer', mode, sdp}  语音/视频通话信令（以下 5 类均由服务器转发给对端）
 *     {type:'call_answer', sdp} / {type:'call_ice', candidate}
 *     {type:'call_end'} / {type:'call_reject'}
 *   服务器 → 客户端：
 *     {type:'room_created', room, color, token}    房主获得房间号与重连凭证
 *     {type:'room_joined', room, color, token}     加入者获得重连凭证
 *     {type:'peer_joined', room}      对手已加入，对局开始
 *     {type:'move', r, c, version}    广播给房间内双方（发送方本地已落子，会忽略回声）
 *     {type:'room_snapshot', board, color, turn, over, winner, version, lastMove}  重连权威快照
 *     {type:'peer_reconnecting'}      对方断线，进入 60s 重连窗口，暂停对局
 *     {type:'peer_reconnected'}       对方已重连，继续对局
 *     {type:'reset'}                  双方同步重开一局
 *     {type:'peer_left'}              房主离开，对局作废
 *     {type:'guest_left'}             对方（白棋）离开，房间保留，可重新邀请
 *     {type:'nickname_update', from, name}   昵称变更广播
 *     {type:'board_size_changed', boardSize} 棋盘大小变更（双方重建棋盘）
 *     {type:'guess_start', selector}  猜先开始：selector 为随机选中的“先选硬币面”一方
 *     {type:'guess_won', winner}      猜先结果揭晓：winner 为赢家（可自选执子）
 *     {type:'color_assigned', hostColor, guestColor}  角色分配完成，对局开始
 *     {type:'call_*', from, ...}      通话信令（offer/answer/ice/end/reject，附 from 角色）
 *     {type:'game_over', winner}      winner 为 'black'/'white'/null（null 表示平局）
 *     {type:'error', message}
 *
 * 服务端是权威：校验是否轮到自己、坐标是否合法、该格是否为空，
 * 以及连五判胜，防止作弊客户端破坏对局。
 * ============================================================ */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

/* ---------------- 配置 ---------------- */
const ROOT_DIR = __dirname;                 // 静态资源根目录 = 本文件所在目录
const BOARD_SIZES = [13, 15, 19];           // 允许的在线棋盘格数（房间级属性，建房时定死）
const DEFAULT_BOARD_SIZE = 19;              // 默认在线棋盘格数（与前端默认一致）
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';  // WebSocket 协议固定魔数
const PORT = Number(process.argv[2]) || Number(process.env.PORT) || 8123;

/* ---------------- 联机可靠性参数（支持环境变量覆盖，自动化测试会缩短） ---------------- */
const HEARTBEAT_INTERVAL_MS = Number(process.env.HEARTBEAT_INTERVAL_MS) || 15000; // 心跳 ping 间隔
const HEARTBEAT_TIMEOUT_MS = Number(process.env.HEARTBEAT_TIMEOUT_MS) || 45000;  // 超过此时长无任何帧（含 pong）视为断线
const RECONNECT_WAIT_MS = Number(process.env.RECONNECT_WAIT_MS) || 60000;        // 断线后等待重连的窗口
const ROOM_STALE_MS = Number(process.env.ROOM_STALE_MS) || 15 * 60 * 1000;       // 建房后无人加入的回收时限
const MAX_MSG_BYTES = 65536;                                                     // 单条消息最大字节数（WebRTC SDP 较大，放宽到 64KB）
const MAX_MSG_PER_SEC = 20;                                                      // 每秒最多消息数，防刷
const CLEANUP_INTERVAL_MS = Number(process.env.CLEANUP_INTERVAL_MS) || 30000;    // 心跳/清理扫描间隔

/* ---------------- 静态文件服务 ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/** 处理普通 HTTP 请求：把 URL 映射到 ROOT_DIR 下的文件并返回 */
function serveStatic(req, res) {
  let urlPath;
  try {
    urlPath = decodeURIComponent(req.url.split('?')[0]);
  } catch (err) {
    res.writeHead(400); res.end('Bad Request'); return;
  }
  if (urlPath === '/') urlPath = '/gomoku.html';

  // 用 path.normalize 消除 ../ 等跳转，再校验前缀，防止目录穿越
  const filePath = path.normalize(path.join(ROOT_DIR, urlPath));
  if (filePath !== ROOT_DIR && !filePath.startsWith(ROOT_DIR + path.sep)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',   // 开发/联调期避免浏览器缓存旧页面
    });
    res.end(data);
  });
}

/* ---------------- WebSocket 帧编解码（RFC 6455 最小实现） ---------------- */

/** 发送一个服务器 → 客户端的帧（服务器不掩码） */
function sendWsFrame(socket, opcode, payload) {
  if (socket.destroyed || !socket.writable) return;
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8');
  const len = data.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x80 | opcode, len]);          // FIN + opcode，7 位长度
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;                                      // 16 位长度标记
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;                                      // 64 位长度标记
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  socket.write(Buffer.concat([header, data]));
}

/** 向某个连接发送 JSON 消息；连接已失效则静默丢弃 */
function wsSend(conn, obj) {
  if (!conn || !conn.socket) return;
  sendWsFrame(conn.socket, 0x1, JSON.stringify(obj));
}

/**
 * 解析并处理 conn 接收缓冲区里的帧。
 * 一次可能读到多个帧，因此返回本次消耗的字节数；0 表示数据不完整。
 * 只关心文本帧（0x1）、续帧（0x0）、关闭（0x8）与 ping（0x9）。
 */
function parseFrame(conn) {
  const buf = conn.buffer;
  if (buf.length < 2) return 0;

  const b0 = buf[0];
  const b1 = buf[1];
  const fin = (b0 & 0x80) !== 0;
  const opcode = b0 & 0x0f;
  const masked = (b1 & 0x80) !== 0;

  let len = b1 & 0x7f;
  let offset = 2;
  if (len === 126) {                       // 扩展 16 位长度
    if (buf.length < offset + 2) return 0;
    len = buf.readUInt16BE(offset);
    offset += 2;
  } else if (len === 127) {                // 扩展 64 位长度
    if (buf.length < offset + 8) return 0;
    len = Number(buf.readBigUInt64BE(offset));
    offset += 8;
  }

  let maskKey = null;
  if (masked) {                            // 客户端帧必须掩码
    if (buf.length < offset + 4) return 0;
    maskKey = buf.subarray(offset, offset + 4);
    offset += 4;
  }
  if (buf.length < offset + len) return 0;

  let payload = buf.subarray(offset, offset + len);
  if (masked) {                            // 逐字节异或解掩码
    payload = Buffer.from(payload);
    for (let i = 0; i < payload.length; i++) payload[i] ^= maskKey[i % 4];
  }

  if (opcode === 0x1 || opcode === 0x0) {  // 文本帧 / 续帧
    conn.fragment = conn.fragment ? Buffer.concat([conn.fragment, payload]) : payload;
    if (fin) {                             // 分片收齐，整体交给业务层
      handleWsText(conn, conn.fragment.toString('utf8'));
      conn.fragment = null;
    }
  } else if (opcode === 0x8) {             // 关闭帧：回一个关闭帧并断开
    sendWsFrame(conn.socket, 0x8, Buffer.alloc(0));
    conn.socket.end();
  } else if (opcode === 0x9) {             // ping → pong
    sendWsFrame(conn.socket, 0xA, payload);
  }
  return offset + len;
}

/** 为一个 socket 建立 WebSocket 会话（含接收缓冲、分片状态、心跳与重连元数据） */
function createWsSession(socket) {
  const conn = {
    socket, buffer: Buffer.alloc(0), fragment: null,
    room: null, cleaned: false,
    token: null,        // 重连凭证（create/join 时下发，重连时校验）
    role: null,         // 'host' | 'guest'：本连接在房间里的角色
    alive: Date.now(),  // 最近一次收到任意帧的时间（心跳判定依据）
    msgTimes: [],       // 最近 1 秒内的消息时间戳（限频防刷）
  };
  allConns.add(conn);
  // 断线清理只执行一次：end（对方半关闭）与 close（完全关闭）都可能触发
  const cleanup = () => {
    if (conn.cleaned) return;
    conn.cleaned = true;
    allConns.delete(conn);
    leaveRoom(conn, false);
  };
  socket.on('data', (chunk) => {
    conn.alive = Date.now();   // 收到任何数据（含浏览器自动回的 pong）都视为存活
    conn.buffer = Buffer.concat([conn.buffer, chunk]);
    while (conn.buffer.length >= 2) {
      const consumed = parseFrame(conn);
      if (consumed <= 0) break;            // 帧不完整，等下一次数据
      conn.buffer = conn.buffer.subarray(consumed);
    }
  });
  socket.on('end', () => { cleanup(); socket.end(); });  // 客户端半关闭也视为断开
  socket.on('close', cleanup);                           // 连接完全关闭时清出房间
  socket.on('error', () => {});                // 防止异常 socket 导致进程崩溃
  return conn;
}

/** WebSocket 握手：校验 Sec-WebSocket-Key 并返回 101 响应 */
function upgradeHandler(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
  );
  createWsSession(socket);
}

/* ---------------- 房间与对局逻辑 ---------------- */

/** 房间表：roomCode → { host, guest, board, turn, over, version, ... }。turn: 0=黑(房主) 1=白(加入者) */
const rooms = new Map();

/** 全局连接集合：心跳探活与限频扫描（含未进房间的连接） */
const allConns = new Set();

/** 生成 5 位房间号：去掉易混淆的 I/O/0/1 */
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function randomCode() {
  let code = '';
  for (let i = 0; i < 5; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return code;
}

/** size×size 空棋盘（0=空 1=黑 2=白）；棋盘大小是房间级属性 */
function emptyBoard(size) {
  return Array.from({ length: size }, () => Array(size).fill(0));
}

/** 服务端判胜：检查刚落的 (r, c) 是否在任一方向连成五子 */
function checkWin(board, r, c) {
  const color = board[r][c];
  const size = board.length;                     // 棋盘大小随房间而定，用 board 实际尺寸判界
  const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
  for (const [dr, dc] of dirs) {
    let count = 1;
    for (let i = 1; i < 5; i++) {
      const nr = r + dr * i, nc = c + dc * i;
      if (nr < 0 || nr >= size || nc < 0 || nc >= size || board[nr][nc] !== color) break;
      count++;
    }
    for (let i = 1; i < 5; i++) {
      const nr = r - dr * i, nc = c - dc * i;
      if (nr < 0 || nr >= size || nc < 0 || nc >= size || board[nr][nc] !== color) break;
      count++;
    }
    if (count >= 5) return true;
  }
  return false;
}

/** 向房间内双方广播消息 */
function broadcast(room, obj) {
  wsSend(room.host, obj);
  wsSend(room.guest, obj);
}

/** 创建房间：发起者成为房主（执黑先手），立即获得房间号与重连 token；棋盘大小建房时定死 */
function handleCreate(conn, boardSize, guess) {
  if (conn.room) { wsSend(conn, { type: 'error', message: '你已在房间中，请先断开' }); return; }
  const size = BOARD_SIZES.includes(Number(boardSize)) ? Number(boardSize) : DEFAULT_BOARD_SIZE;
  let code;
  do { code = randomCode(); } while (rooms.has(code));
  const token = crypto.randomBytes(16).toString('hex');
  const room = {
    host: conn, guest: null, board: emptyBoard(size), turn: 0, over: false,
    boardSize: size,            // 房间级棋盘大小：加入者/重连快照都以此为权威
    hostToken: token, guestToken: null,
    nicknames: { host: '', guest: '' },   // 双方昵称（可随时修改并广播给对方）
    hostColor: 'black', guestColor: 'white',   // 执子颜色：默认房主黑；猜先开启时由猜先结果决定
    guessed: guess ? false : true,        // 是否已完成猜先；false 表示双方就位后先猜先再开局
    guessCoin: null, guessSelector: null, guessWinner: null,   // 猜先过程状态（服务器权威随机）
    version: 0, lastMove: null, lastColor: 0,
    createdAt: Date.now(), waitingFor: null, reconnectDeadline: 0,
    everJoined: false,           // 是否曾有加入者进过房（防止重连窗口期间被超时回收误删）
  };
  rooms.set(code, room);
  conn.room = code;
  conn.token = token;
  conn.role = 'host';
  wsSend(conn, { type: 'room_created', room: code, color: room.hostColor, token, boardSize: size, guessPending: !room.guessed });
}

/**
 * 加入房间：以白棋身份加入，通知房主“对手已就位”，并下发重连 token。
 * 支持“对方离开后重新加入 / 新对手中途加入”：
 * - guest 空位（对方离开或重连超时）时可直接加入；
 * - 对局已结束（over）时视为“换新对手”，自动清空棋盘重开；
 * - 棋盘已有棋子（原对方中途离场）时追加 room_snapshot，新加入者按快照恢复局面。 */
function handleJoin(conn, code) {
  if (conn.room) { wsSend(conn, { type: 'error', message: '你已在房间中，请先断开' }); return; }
  const room = rooms.get(code);
  if (!room) { wsSend(conn, { type: 'error', message: '房间不存在' }); return; }
  if (room.guest) { wsSend(conn, { type: 'error', message: '房间已满' }); return; }
  if (!room.host || !room.host.socket || room.host.socket.destroyed) {
    wsSend(conn, { type: 'error', message: '房主已离开，房间关闭' }); return;
  }
  if (room.over) {
    // 终局后对手离开：新对手加入即重开一局（保留房间号与棋盘大小）
    room.board = emptyBoard(room.boardSize);
    room.turn = 0; room.over = false; room.version = 0;
    room.lastMove = null; room.lastColor = 0;
    room.waitingFor = null; room.reconnectDeadline = 0;
  }
  const token = crypto.randomBytes(16).toString('hex');
  room.guest = conn;
  room.guestToken = token;
  room.everJoined = true;
  room.waitingFor = null;                 // 取消旧的“等待 guest 重连”窗口（新对手直接接管）
  room.reconnectDeadline = 0;
  conn.room = code;
  conn.token = token;
  conn.role = 'guest';
  wsSend(conn, { type: 'room_joined', room: code, color: room.guestColor, token, boardSize: room.boardSize, guessPending: !room.guessed });
  wsSend(room.host, { type: 'peer_joined', room: code, boardSize: room.boardSize, guessPending: !room.guessed });
  // 首次双方就位且建房时开启猜先 → 服务器权威掷硬币，公平决定谁执黑
  if (!room.guessed) startGuess(room);
  // 棋盘已有棋子（对方中途离场后续局）：追加权威快照，让新加入者直接恢复局面
  if (room.board.some((row) => row.some((v) => v !== 0))) {
    wsSend(conn, {
      type: 'room_snapshot', room: code, board: room.board, boardSize: room.boardSize,
      color: room.guestColor, role: 'guest', turn: room.turn, over: room.over, winner: null,
      version: room.version, lastMove: room.lastMove,
    });
  }
}

/**
 * 开局猜先（服务器权威，公平不可作弊）：
 * ① 服务器随机决定硬币结果（heads/tails）与“先选硬币面”的一方（selector）；
 * ② 先选方选正面/反面，选对则先选方赢，选错则对方赢（双方概率各 50%）；
 * ③ 赢家自选执黑（先手）或执白，服务器据此分配角色并广播 color_assigned。
 */
function startGuess(room) {
  room.guessCoin = Math.random() < 0.5 ? 'heads' : 'tails';
  room.guessSelector = Math.random() < 0.5 ? 'host' : 'guest';
  room.guessWinner = null;
  room.over = false;
  room.board = emptyBoard(room.boardSize);     // 猜先期间棋盘保持为空
  broadcast(room, { type: 'guess_start', selector: room.guessSelector });
}

/** 猜先：先选方选硬币面（仅允许被选中的一方提交一次） */
function handleGuessPick(conn, side) {
  const room = rooms.get(conn.room);
  if (!room) { wsSend(conn, { type: 'error', message: '未加入房间' }); return; }
  if (room.guessed || room.guessCoin === null) return;            // 未处于猜先阶段
  const me = room.host === conn ? 'host' : 'guest';
  if (me !== room.guessSelector) { wsSend(conn, { type: 'error', message: '还没轮到你选硬币' }); return; }
  if (side !== 'heads' && side !== 'tails') { wsSend(conn, { type: 'error', message: '只能选正面或反面' }); return; }
  room.guessWinner = (side === room.guessCoin) ? room.guessSelector : (room.guessSelector === 'host' ? 'guest' : 'host');
  broadcast(room, { type: 'guess_won', winner: room.guessWinner });
}

/** 猜先：赢家选择执黑（先手）或执白 */
function handleGuessColor(conn, color) {
  const room = rooms.get(conn.room);
  if (!room) { wsSend(conn, { type: 'error', message: '未加入房间' }); return; }
  if (room.guessed || !room.guessWinner) return;
  const me = room.host === conn ? 'host' : 'guest';
  if (me !== room.guessWinner) { wsSend(conn, { type: 'error', message: '只有赢家能选择执子' }); return; }
  if (color !== 'black' && color !== 'white') { wsSend(conn, { type: 'error', message: '只能选执黑或执白' }); return; }
  if (room.guessWinner === 'host') {
    room.hostColor = color; room.guestColor = color === 'black' ? 'white' : 'black';
  } else {
    room.guestColor = color; room.hostColor = color === 'black' ? 'white' : 'black';
  }
  finishGuess(room);
}

/** 猜先：先选方跳过 → 默认房主执黑（与旧行为一致，跳过即双方同意不猜） */
function handleGuessSkip(conn) {
  const room = rooms.get(conn.room);
  if (!room) { wsSend(conn, { type: 'error', message: '未加入房间' }); return; }
  if (room.guessed || room.guessCoin === null) return;
  const me = room.host === conn ? 'host' : 'guest';
  if (me !== room.guessSelector) { wsSend(conn, { type: 'error', message: '还没轮到你' }); return; }
  room.hostColor = 'black'; room.guestColor = 'white';
  finishGuess(room);
}

/** 猜先收尾：固化颜色、清空棋盘重开一局（黑先），广播 color_assigned */
function finishGuess(room) {
  room.guessed = true;
  room.guessCoin = null; room.guessSelector = null; room.guessWinner = null;
  room.board = emptyBoard(room.boardSize);
  room.turn = 0; room.over = false; room.version = 0;
  room.lastMove = null; room.lastColor = 0;
  broadcast(room, { type: 'color_assigned', hostColor: room.hostColor, guestColor: room.guestColor, boardSize: room.boardSize });
}

/** 处理落子：服务端做全部校验，通过后广播，并检测胜负 */
function handleMove(conn, r, c) {
  const room = rooms.get(conn.room);
  if (!room) { wsSend(conn, { type: 'error', message: '未加入房间' }); return; }
  if (room.over) { wsSend(conn, { type: 'error', message: '对局已结束' }); return; }
  if (!room.guest) { wsSend(conn, { type: 'error', message: '等待对手加入' }); return; }
  if (!room.guessed) { wsSend(conn, { type: 'error', message: '请先完成开局猜先' }); return; }

  const isHost = room.host === conn;
  const myColorName = isHost ? room.hostColor : room.guestColor;   // 执子颜色由猜先决定，不再绑定角色
  const myTurn = (room.turn === 0 && myColorName === 'black') || (room.turn === 1 && myColorName === 'white');
  if (!myTurn) { wsSend(conn, { type: 'error', message: '还没轮到你落子' }); return; }

  r = Number(r);
  c = Number(c);
  if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || r >= room.boardSize || c < 0 || c >= room.boardSize) {
    wsSend(conn, { type: 'error', message: '落子超出棋盘范围' }); return;
  }
  if (room.board[r][c] !== 0) { wsSend(conn, { type: 'error', message: '该位置已有棋子' }); return; }

  room.board[r][c] = myColorName === 'black' ? 1 : 2;
  const winnerColor = myColorName;
  room.version++;                          // 局面版本号：重连快照一致性
  room.lastMove = [r, c];
  room.lastColor = myColorName === 'black' ? 1 : 2;
  const won = checkWin(room.board, r, c);
  room.turn = 1 - room.turn;               // 换手
  broadcast(room, { type: 'move', r, c, version: room.version }); // 双方各自应用（发送方因格子已占而忽略回声）

  if (won) {
    room.over = true;
    broadcast(room, { type: 'game_over', winner: winnerColor });
  } else if (room.board.every((row) => row.every((v) => v !== 0))) {
    room.over = true;                      // 棋盘下满 → 平局
    broadcast(room, { type: 'game_over', winner: null });
  }
}

/** 双方重开一局（“再来一局”：仅对局结束后允许，任一方发起即双方同步重开） */
function handleRematch(conn) {
  const room = rooms.get(conn.room);
  if (!room) { wsSend(conn, { type: 'error', message: '未加入房间' }); return; }
  if (!room.over) { wsSend(conn, { type: 'error', message: '对局尚未结束，不能重开' }); return; }
  if (!room.host || !room.guest) { wsSend(conn, { type: 'error', message: '双方都在线才能重开' }); return; }
  room.board = emptyBoard(room.boardSize);
  room.turn = 0;
  room.over = false;
  room.version = 0;
  room.lastMove = null;
  room.lastColor = 0;
  room.waitingFor = null;
  room.reconnectDeadline = 0;
  broadcast(room, { type: 'reset' });      // 前端收到 reset 后同步重开（保留在线连接）
}

/**
 * 断线重连：用建房/加入时下发的 token 找回原房间，恢复原角色与当前局面。
 * 校验通过后把新连接替换进房间，向重连方下发 room_snapshot（权威快照），
 * 并通知对端“对方已重连”。 */
function handleReconnect(conn, code, token) {
  if (conn.room) { wsSend(conn, { type: 'error', message: '你已在房间中，请先断开' }); return; }
  const room = rooms.get(code);
  if (!room) { wsSend(conn, { type: 'error', message: '房间不存在或已关闭' }); return; }
  const isHost = token && token === room.hostToken;
  const isGuest = token && token === room.guestToken;
  if (!isHost && !isGuest) { wsSend(conn, { type: 'error', message: '重连凭证无效' }); return; }

  const cur = isHost ? room.host : room.guest;
  if (cur && cur.socket && !cur.socket.destroyed) {
    wsSend(conn, { type: 'error', message: '原连接仍在线，无需重连' }); return;
  }

  conn.room = code;
  conn.token = token;
  conn.role = isHost ? 'host' : 'guest';
  if (isHost) room.host = conn; else room.guest = conn;
  room.waitingFor = null;
  room.reconnectDeadline = 0;

  // 权威快照：重连方直接用服务端局面重建本地棋盘（不走落子消息重放）
  wsSend(conn, {
    type: 'room_snapshot',
    room: code,                          // 房间号：前端重连后恢复 roomCode（聊天/格数锁定依赖）
    board: room.board,
    boardSize: room.boardSize,           // 房间级棋盘大小：重连方据此重建画布
    color: isHost ? room.hostColor : room.guestColor,   // 我的执子颜色（猜先后可能与角色解耦）
    role: isHost ? 'host' : 'guest',     // 角色：前端据此恢复 isHost（不再用颜色推断）
    turn: room.turn,
    over: room.over,
    winner: room.over ? (room.lastColor === 1 ? 'black' : room.lastColor === 2 ? 'white' : null) : null,
    version: room.version,
    lastMove: room.lastMove,
    nicknames: room.nicknames,           // 昵称：重连/快照后前端恢复双方显示名
  });
  // 猜先尚未完成（对方加入后我方刷新页面）→ 补发猜先流程状态，新连接继续参与
  if (!room.guessed) {
    if (room.guessCoin !== null) wsSend(conn, { type: 'guess_start', selector: room.guessSelector });
    if (room.guessWinner) wsSend(conn, { type: 'guess_won', winner: room.guessWinner });
  }

  const peer = isHost ? room.guest : room.host;
  if (peer && peer.socket && !peer.socket.destroyed) {
    wsSend(peer, { type: 'peer_reconnected' });
  }
}

/**
 * 连接断开处理：
 * - 主动离开（客户端发 leave 消息）：立即作废对局、通知对端、必要时回收房间；
 * - 非主动断开（断网/刷新页面）且持有重连凭证：进入 RECONNECT_WAIT_MS 等待窗口，
 *   对端收到 peer_reconnecting 并暂停对局；窗口内用 token 重连可恢复，超时则正式离开。 */
function leaveRoom(conn, intentional) {
  if (!conn.room) return;
  const code = conn.room;
  const room = rooms.get(code);
  const hadToken = !!conn.token;           // 先保存重连凭证，再清空连接状态（重连窗口判定要用）
  conn.room = null;
  conn.token = null;
  conn.role = null;
  if (!room) return;

  const isHost = room.host === conn;
  if (isHost) room.host = null; else room.guest = null;
  const peer = isHost ? room.guest : room.host;

  // 房主离开：对局作废，通知对方（若在线），房间立即回收
  if (isHost) {
    if (peer && peer.socket && !peer.socket.destroyed) {
      room.over = true;
      wsSend(peer, { type: 'peer_left' });
    }
    rooms.delete(code);
    return;
  }

  // 非主动断开且持有重连凭证 → 进入等待重连窗口（刷新页面/断网可自动回房）
  if (!intentional && !room.over && hadToken) {
    room.waitingFor = 'guest';
    room.reconnectDeadline = Date.now() + RECONNECT_WAIT_MS;
    if (peer && peer.socket && !peer.socket.destroyed) {
      wsSend(peer, { type: 'peer_reconnecting' });
    }
    return;
  }
  // 对方（白棋）离开：房间保留、棋盘保留，房主可重新邀请原对方或新对手
  if (peer && peer.socket && !peer.socket.destroyed) {
    wsSend(peer, { type: 'guest_left' });
  }
}

/** 设置昵称：≤12 字符，广播给房间内双方（含发送方，前端本地应用） */
function handleNickname(conn, name) {
  const room = rooms.get(conn.room);
  if (!room) { wsSend(conn, { type: 'error', message: '未加入房间' }); return; }
  const clean = String(name || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, 12);
  if (!clean) return;                                   // 空昵称忽略
  const from = room.host === conn ? 'host' : 'guest';
  room.nicknames[from] = clean;
  broadcast(room, { type: 'nickname_update', from, name: clean });
}

/**
 * 修改房间棋盘大小：仅房主；任何阶段都可改（即使对局已开始）。
 * 改大小 = 双方清空棋盘、重开一局（黑方=房主先手），旧棋局作废。
 */
function handleSetBoardSize(conn, size) {
  const room = rooms.get(conn.room);
  if (!room) { wsSend(conn, { type: 'error', message: '未加入房间' }); return; }
  if (room.host !== conn) { wsSend(conn, { type: 'error', message: '仅房主可以修改棋盘大小' }); return; }
  const s = Number(size);
  if (!BOARD_SIZES.includes(s)) { wsSend(conn, { type: 'error', message: '棋盘格数非法' }); return; }
  room.boardSize = s;
  room.board = emptyBoard(s);            // 新大小重开一局：清空棋盘、黑先、清除终局状态
  room.turn = 0; room.over = false; room.version = 0;
  room.lastMove = null; room.lastColor = 0;
  broadcast(room, { type: 'board_size_changed', boardSize: s });
}

/** 房主重置房间：对方不在线时清空棋盘，等待新对手重新加入 */
function handleResetRoom(conn) {
  const room = rooms.get(conn.room);
  if (!room) { wsSend(conn, { type: 'error', message: '未加入房间' }); return; }
  if (room.host !== conn) { wsSend(conn, { type: 'error', message: '仅房主可以重置房间' }); return; }
  if (room.guest && room.guest.socket && !room.guest.socket.destroyed) {
    wsSend(conn, { type: 'error', message: '对方仍在线，请先让对方离开' }); return;
  }
  room.board = emptyBoard(room.boardSize);
  room.turn = 0; room.over = false; room.version = 0;
  room.lastMove = null; room.lastColor = 0;
  room.guestToken = null;                 // 旧 guest 凭证作废（防止旧连接重连抢位）
  room.waitingFor = null; room.reconnectDeadline = 0;
  wsSend(conn, { type: 'reset' });
}

/** 通话信令转发：只把 5 类 call_* 消息原样转发给对端，并附上发送方角色 */
function handleCallSignal(conn, msg) {
  const room = rooms.get(conn.room);
  if (!room) { wsSend(conn, { type: 'error', message: '未加入房间' }); return; }
  const peer = room.host === conn ? room.guest : room.host;
  if (!peer || !peer.socket || peer.socket.destroyed) {
    wsSend(conn, { type: 'error', message: '对方不在线，无法通话' }); return;
  }
  const allowed = ['call_offer', 'call_answer', 'call_ice', 'call_end', 'call_reject'];
  if (!allowed.includes(msg.type)) return;
  wsSend(peer, Object.assign({}, msg, { from: conn.role }));   // 覆盖 from，防止伪造
}

/** 聊天消息：校验房间与双方在线后，把消息广播给房间内双方（含发送方，前端本地去重） */
function handleChat(conn, text) {
  const room = rooms.get(conn.room);
  if (!room) { wsSend(conn, { type: 'error', message: '未加入房间' }); return; }
  const clean = String(text || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, 200);
  if (!clean) return;                                  // 空消息直接忽略
  const from = room.host === conn ? 'host' : 'guest';
  const color = room.host === conn ? 'black' : 'white';
  broadcast(room, { type: 'chat', from, color, text: clean, ts: Date.now() });
}

/** WebSocket 文本消息入口：限频/大小校验后按 type 分发 */
function handleWsText(conn, text) {
  // 限频防刷：1 秒窗口内消息数超上限直接断开
  const now = Date.now();
  conn.msgTimes = conn.msgTimes.filter((t) => now - t < 1000);
  if (conn.msgTimes.length >= MAX_MSG_PER_SEC) { conn.socket.destroy(); return; }
  conn.msgTimes.push(now);
  // 消息体过大（恶意大包）直接断开
  if (Buffer.byteLength(text, 'utf8') > MAX_MSG_BYTES) { conn.socket.destroy(); return; }

  let msg;
  try { msg = JSON.parse(text); } catch (err) { return; }
  switch (msg.type) {
    case 'create':
      handleCreate(conn, msg.boardSize, !!msg.guess);
      break;
    case 'join':
      handleJoin(conn, String(msg.room || '').toUpperCase().replace(/[^A-Z0-9]/g, ''));
      break;
    case 'reconnect':
      handleReconnect(conn, String(msg.room || '').toUpperCase().replace(/[^A-Z0-9]/g, ''), String(msg.token || ''));
      break;
    case 'move':
      handleMove(conn, msg.r, msg.c);
      break;
    case 'reset':
      handleRematch(conn);                 // 重开仅限对局结束后，语义与 rematch 一致
      break;
    case 'rematch':
      handleRematch(conn);
      break;
    case 'chat':
      handleChat(conn, msg.text);
      break;
    case 'nickname':
      handleNickname(conn, msg.name);
      break;
    case 'set_board_size':
      handleSetBoardSize(conn, msg.size);
      break;
    case 'guess_pick':
      handleGuessPick(conn, String(msg.side || ''));
      break;
    case 'guess_color':
      handleGuessColor(conn, String(msg.color || ''));
      break;
    case 'guess_skip':
      handleGuessSkip(conn);
      break;
    case 'reset_room':
      handleResetRoom(conn);
      break;
    case 'call_offer':
    case 'call_answer':
    case 'call_ice':
    case 'call_end':
    case 'call_reject':
      handleCallSignal(conn, msg);
      break;
    case 'leave':
      leaveRoom(conn, true);               // 主动离开：立即释放房间与对局
      break;
    default:
      wsSend(conn, { type: 'error', message: '未知消息类型' });
  }
}

/* ---------------- 心跳保活与房间清理 ---------------- */

/**
 * 周期任务（CLEANUP_INTERVAL_MS 触发一次）：
 * ① 心跳：对所有连接发 ping 探活；超过 HEARTBEAT_TIMEOUT_MS 无任何帧则销毁连接，
 *    销毁触发 close → leaveRoom →（有 token 时）进入重连窗口；
 * ② 重连窗口超时：等待重连方未归 → 按正式离开处理并通知对端；
 * ③ 建房后 ROOM_STALE_MS 无人加入 → 回收房间并提示房主。 */
function startHousekeeping() {
  setInterval(() => {
    const now = Date.now();

    for (const conn of allConns) {
      if (conn.socket.destroyed) continue;
      sendWsFrame(conn.socket, 0x9, Buffer.alloc(0));   // ping（浏览器自动回 pong）
      if (now - conn.alive > HEARTBEAT_TIMEOUT_MS) {
        conn.socket.destroy();
      }
    }

    for (const [code, room] of rooms) {
      if (room.reconnectDeadline && now > room.reconnectDeadline) {
        room.reconnectDeadline = 0;
        const who = room.waitingFor;
        room.waitingFor = null;
        if (who === 'host') {
          // 房主重连超时：对局作废并回收房间（房主是房间的持有者）
          if (room.guest && room.guest.socket && !room.guest.socket.destroyed) {
            room.over = true;
            wsSend(room.guest, { type: 'peer_left' });
          }
          rooms.delete(code);
        } else {
          // 对方（白棋）重连超时：房间保留，通知房主可重新邀请
          if (room.host && room.host.socket && !room.host.socket.destroyed) {
            wsSend(room.host, { type: 'guest_left' });
          }
        }
      }

      if (!room.guest && !room.everJoined && room.host && now - room.createdAt > ROOM_STALE_MS) {
        if (room.host.socket && !room.host.socket.destroyed) {
          wsSend(room.host, { type: 'error', message: '房间等待超时，已自动关闭' });
        }
        room.host.room = null;
        room.host = null;
        rooms.delete(code);
      }
    }
  }, CLEANUP_INTERVAL_MS);
}


/* ---------------- 启动 ---------------- */

const server = http.createServer(serveStatic);

// 只有 /ws 路径升级为 WebSocket，其余路径一律拒绝
server.on('upgrade', (req, socket) => {
  if (req.url.split('?')[0] !== '/ws') { socket.destroy(); return; }
  upgradeHandler(req, socket);
});

/** 收集本机局域网 IPv4 地址，方便手机在同一 WiFi 下访问 */
function lanAddresses() {
  const list = [];
  for (const infos of Object.values(os.networkInterfaces())) {
    for (const info of infos || []) {
      if (info.family === 'IPv4' && !info.internal) list.push(info.address);
    }
  }
  return list;
}

startHousekeeping();
server.listen(PORT, '0.0.0.0', () => {
  console.log('五子棋在线对战服务器已启动 (端口 ' + PORT + ')');
  console.log('  本机访问：  http://127.0.0.1:' + PORT + '/');
  for (const ip of lanAddresses()) {
    console.log('  局域网访问：http://' + ip + ':' + PORT + '/  （手机连同一 WiFi 可打开）');
  }
  console.log('  注意：手机访问请放行 Windows 防火墙对 Node.js 的入站连接。');
});
