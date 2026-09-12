const fs = require('fs');
const p = 'work/ws-test.js';
let s = fs.readFileSync(p, 'utf8');

const section = `
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

`;

const anchor = "  console.log('== 通话信令转发（call_offer/answer/ice/end） ==');";
if (!s.includes(anchor)) { console.error('ANCHOR NOT FOUND'); process.exit(1); }
s = s.split(anchor).join(section + anchor);

// 头部注释补一句
s = s.split(' * 覆盖：建房/加入/落子/判胜/悔棋语义、断线重连（快照恢复）、')
      .join(' * 覆盖：建房/加入/落子/判胜/悔棋语义、联机猜先、断线重连（快照恢复）、');

fs.writeFileSync(p, s, 'utf8');
console.log('ws-test.js patched');
