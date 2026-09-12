'use strict';
/* ============================================================
 * 联机端到端测试（真实浏览器，Playwright + 本地服务器）
 * ------------------------------------------------------------
 * 流程：建房（自动复制/二维码/大字房间号）→ 邀请链接入局 → 对弈数手
 *       → 刷新页面自动重连恢复局面 → 继续对弈至分出胜负
 *       → 再来一局 → 重开后继续落子；联机猜先（默认开启，颜色与角色解耦）。
 * 说明：主流程建房前关闭“开局猜先”以保持固定黑白断言；猜先流程在独立小节验证。
 * 用法（需先用捆绑 Node 提供 playwright）：
 *   node work/online-e2e.js
 * ============================================================ */
const { spawn } = require('child_process');
const { chromium } = require('playwright');

const PORT = 8124;
const BASE = 'http://127.0.0.1:' + PORT + '/';
const serverProc = spawn(process.execPath, ['outputs/gomoku-server.js', String(PORT)], {
  cwd: __dirname + '\\..', stdio: ['ignore', 'pipe', 'pipe'],
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

(async () => {
  await waitMs(500);
  const browser = await chromium.launch({
    channel: 'msedge', headless: true,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],  // 假麦克风/摄像头，供通话测试
  });
  const ctxHost = await browser.newContext({ viewport: { width: 1100, height: 850 }, permissions: ['camera', 'microphone'] });
  const ctxGuest = await browser.newContext({ viewport: { width: 1100, height: 850 }, permissions: ['camera', 'microphone'] });
  const host = await ctxHost.newPage();
  const guest = await ctxGuest.newPage();
  const errs = [];
  host.on('pageerror', (e) => errs.push('HOST: ' + e.message));
  guest.on('pageerror', (e) => errs.push('GUEST: ' + e.message));

  const skipGuess = async (page) => {
    await page.waitForTimeout(400);
    await page.locator('#btnGuessSkip').click().catch(() => {});
    await page.waitForTimeout(200);
  };
  const boardBox = async (page) => page.locator('#board').boundingBox();
  // locator.click({position}) 会自动把棋盘滚入视口并落在格点中心，
  // 避免在线面板（玩家栏/聊天/二维码）把棋盘推到视口外导致点击落空。
  const clickCell = async (page, bx, r, c) => {
    const step = (bx.width - 40) / 18;          // 19 路格距 = 40px；按实际画布宽度自适应
    await page.locator('#board').click({ position: { x: 20 + c * step, y: 20 + r * step } });
  };
  // 联机猜先全流程：被选中方猜硬币面 → 赢家选执黑 → 等 color_assigned 开局。
  // 硬币结果与先选方都由服务器随机决定，这里自适应读取弹窗状态，不依赖具体哪一方。
  const completeOnlineGuess = async (hostPage, guestPage) => {
    await hostPage.waitForTimeout(700);
    await guestPage.waitForTimeout(700);
    const hCoin = await hostPage.locator('#ogCoinPick').isVisible();
    const gCoin = await guestPage.locator('#ogCoinPick').isVisible();
    if (hCoin) await hostPage.locator('#ogBtnHeads').click();
    else if (gCoin) await guestPage.locator('#ogBtnHeads').click();
    else throw new Error('猜先弹窗未出现（ogCoinPick 双方都不可见）');
    await hostPage.waitForTimeout(500);
    await guestPage.waitForTimeout(500);
    const hPick = await hostPage.locator('#ogColorPick').isVisible();
    const gPick = await guestPage.locator('#ogColorPick').isVisible();
    if (hPick) await hostPage.locator('#ogBtnBlack').click();
    else if (gPick) await guestPage.locator('#ogBtnBlack').click();
    else throw new Error('猜先结果未揭晓（ogColorPick 双方都不可见）');
    await hostPage.waitForTimeout(700);
    await guestPage.waitForTimeout(700);
  };

  console.log('== 1. 房主建房：自动复制 / 大字房间号 / 二维码 ==');
  await host.goto(BASE, { waitUntil: 'load' });
  await skipGuess(host);
  await host.locator('#btnOnline').click();
  await host.waitForTimeout(400);
  await host.locator('#guessFirstToggle').uncheck();   // 主流程关猜先：固定“房主黑、加入者白”，猜先单独验证
  await host.waitForTimeout(200);
  await host.locator('#btnCreateRoom').click();
  await host.waitForTimeout(800);

  const hostStatus = (await host.locator('#onlineStatus').textContent()).trim();
  const inviteVal = (await host.locator('#inviteLinkInput').inputValue()).trim();
  assert(/房间已创建/.test(hostStatus) && /自动复制/.test(hostStatus), '建房状态提示含自动复制: ' + hostStatus);
  assert(/room=[A-Z0-9]{5}/i.test(inviteVal), '邀请链接含房间号: ' + inviteVal);
  const roomMatch = inviteVal.match(/room=([A-Z0-9]{5})/i);
  const roomCode = roomMatch[1].toUpperCase();

  const roomCodeBig = await host.locator('#roomCodeBig').textContent();
  assert(roomCodeBig.includes(roomCode), '大字房间号显示: ' + roomCodeBig.trim());
  const qrVisible = await host.locator('#qrWrap').isVisible();
  const qrLen = await host.evaluate(() => document.querySelector('#qrCanvas').toDataURL('image/png').length);
  assert(qrVisible && qrLen > 1000, '二维码已绘制 (canvas ' + qrLen + 'B)');

  console.log('== 2. 对方打开邀请链接入局 ==');
  await guest.goto(inviteVal, { waitUntil: 'load' });
  await skipGuess(guest);
  await guest.waitForTimeout(1000);
  const guestStatus = (await guest.locator('#onlineStatus').textContent()).trim();
  assert(/已加入房间/.test(guestStatus), '对方状态: ' + guestStatus);
  await host.waitForTimeout(800);
  const hostStatus2 = (await host.locator('#onlineStatus').textContent()).trim();
  assert(/对局开始/.test(hostStatus2), '房主确认对局开始: ' + hostStatus2);

  console.log('== 3. 对弈数手（黑=房主先手） ==');
  const bh = await boardBox(host);
  const bg = await boardBox(guest);
  const hostMoves = [[9, 9], [9, 10]];
  const guestMoves = [[8, 9], [8, 10]];
  for (let i = 0; i < 2; i++) {
    await clickCell(host, bh, hostMoves[i][0], hostMoves[i][1]);
    await host.waitForTimeout(400);
    await clickCell(guest, bg, guestMoves[i][0], guestMoves[i][1]);
    await guest.waitForTimeout(400);
  }
  const hCount = await host.evaluate(() => moveCount);
  const gCount = await guest.evaluate(() => moveCount);
  assert(hCount === 4 && gCount === 4, '双方棋盘同步 (4 手)');

  console.log('== 4. 对方刷新页面 → 自动重连恢复局面 ==');
  await guest.reload({ waitUntil: 'load' });
  await skipGuess(guest);
  await guest.waitForTimeout(1800);
  const guestStatusAfter = (await guest.locator('#onlineStatus').textContent()).trim();
  assert(/重连成功/.test(guestStatusAfter), '对方重连成功: ' + guestStatusAfter);
  const gCountAfter = await guest.evaluate(() => moveCount);
  assert(gCountAfter === 4, '刷新后棋盘局面恢复 (moveCount=' + gCountAfter + ')');
  await host.waitForTimeout(600);
  const hostStatusAfter = (await host.locator('#onlineStatus').textContent()).trim();
  assert(/已重连|继续对局/.test(hostStatusAfter), '房主收到对方重连通知: ' + hostStatusAfter);

  console.log('== 5. 继续对弈至黑棋获胜 ==');
  const bh2 = await boardBox(host);
  const bg2 = await boardBox(guest);
  const hostMoves2 = [[9, 11], [9, 12], [9, 13]];
  const guestMoves2 = [[8, 11], [8, 12]];
  for (let i = 0; i < 2; i++) {
    await clickCell(host, bh2, hostMoves2[i][0], hostMoves2[i][1]);
    await host.waitForTimeout(400);
    await clickCell(guest, bg2, guestMoves2[i][0], guestMoves2[i][1]);
    await guest.waitForTimeout(400);
  }
  await clickCell(host, bh2, hostMoves2[2][0], hostMoves2[2][1]);   // 黑棋第 5 子连五
  await host.waitForTimeout(800);
  await guest.waitForTimeout(800);
  const hStatusWin = (await host.locator('#status').textContent()).trim();
  const gStatusWin = (await guest.locator('#status').textContent()).trim();
  assert(/黑棋获胜|你赢了/.test(hStatusWin), '房主视角黑棋获胜: ' + hStatusWin);
  assert(/黑棋获胜|你输了/.test(gStatusWin), '对方视角黑棋获胜: ' + gStatusWin);
  const hRematchVisible = await host.locator('#btnRematch').isVisible();
  const hRematchEnabled = !(await host.locator('#btnRematch').isDisabled());
  assert(hRematchVisible && hRematchEnabled, '房主侧【再来一局】可用');
  const gRematchEnabled = !(await guest.locator('#btnRematch').isDisabled());
  assert(gRematchEnabled, '对方侧【再来一局】可用');

  console.log('== 6. 再来一局 → 双方同步重开 ==');
  await host.locator('#btnRematch').click();
  await host.waitForTimeout(1000);
  await guest.waitForTimeout(1000);
  const hCountReset = await host.evaluate(() => moveCount);
  const gCountReset = await guest.evaluate(() => moveCount);
  assert(hCountReset === 0 && gCountReset === 0, '双方棋盘清零 (moveCount=0)');
  const hStatusReset = (await host.locator('#status').textContent()).trim();
  assert(/你的回合/.test(hStatusReset), '重开后房主黑棋先行: ' + hStatusReset);
  await clickCell(host, await boardBox(host), 5, 5);
  await host.waitForTimeout(600);
  await guest.waitForTimeout(600);
  const gCountReplay = await guest.evaluate(() => moveCount);
  assert(gCountReplay === 1, '重开后落子同步到对方 (moveCount=1)');

  console.log('== 7. 玩家栏与回合指示（在线可视化） ==');
  const myName = (await host.locator('#myPlayerName').textContent()).trim();
  const peerName = (await host.locator('#peerPlayerName').textContent()).trim();
  assert(/你（黑棋）/.test(myName) && /对方（白棋）/.test(peerName), '房主玩家栏显示执子: ' + myName + ' / ' + peerName);
  const gMyName = (await guest.locator('#myPlayerName').textContent()).trim();
  const gPeerName = (await guest.locator('#peerPlayerName').textContent()).trim();
  assert(/你（白棋）/.test(gMyName) && /对方（黑棋）/.test(gPeerName), '加入者玩家栏显示执子: ' + gMyName + ' / ' + gPeerName);
  // 第 6 节房主刚下了一手，现在轮到加入者（白棋）
  const hostPeerActive = await host.locator('#peerPlayerCard').evaluate((el) => el.classList.contains('active'));
  assert(hostPeerActive, '对方回合时房主的“对方”玩家卡高亮');
  const gMyActive = await guest.locator('#myPlayerCard').evaluate((el) => el.classList.contains('active'));
  assert(gMyActive, '轮到加入者时“你”的玩家卡高亮');

  console.log('== 8. 聊天（折叠开关 + 双向收发） ==');
  await host.locator('#btnChatToggle').click();                 // 展开聊天
  const chatVisible = await host.locator('#chatPanel').isVisible();
  assert(chatVisible, '点【聊天】后聊天面板展开');
  await host.locator('#chatInput').fill('你好，加油！');
  await host.keyboard.press('Enter');                            // 回车发送
  await guest.waitForTimeout(800);
  const gChatText = (await guest.locator('#chatLog').textContent()).trim();
  assert(gChatText.includes('你好，加油！') && gChatText.includes('对方'), '加入者收到房主消息: ' + gChatText);
  const hChatText = (await host.locator('#chatLog').textContent()).trim();
  assert(hChatText.includes('你好，加油！') && hChatText.includes('我'), '房主本地显示自己的消息: ' + hChatText);
  await guest.locator('#btnChatToggle').click();
  await guest.locator('#chatInput').fill('收到！');
  await guest.locator('#btnChatSend').click();                   // 按钮发送
  await host.waitForTimeout(800);
  const hChat2 = (await host.locator('#chatLog').textContent()).trim();
  assert(hChat2.includes('收到！'), '房主收到加入者回复: ' + hChat2);

  console.log('== 9. 棋盘格数（13 路房间） ==');
  const H2 = await ctxHost.newPage();
  await H2.goto(BASE, { waitUntil: 'load' });
  await skipGuess(H2);
  await H2.click('#btnOnline');
  await H2.waitForTimeout(300);
  await H2.locator('#guessFirstToggle').uncheck();              // 关猜先：本节固定黑白
  await H2.selectOption('#boardSizeSelect', '13');               // 建房前选 13 路
  await H2.waitForTimeout(300);
  await H2.click('#btnCreateRoom');
  await H2.waitForTimeout(800);
  const h2Size = await H2.evaluate(() => boardSize);
  assert(h2Size === 13, '房主以 13 路建房 (boardSize=' + h2Size + ')');
  const sizeHostEditable = !(await H2.locator('#boardSizeSelect').isDisabled());
  assert(sizeHostEditable, '房主入房后未开局时可修改棋盘大小');
  const invite13 = (await H2.locator('#inviteLinkInput').inputValue()).trim();
  const G2 = await ctxGuest.newPage();
  await G2.goto(invite13, { waitUntil: 'load' });
  await skipGuess(G2);
  await G2.waitForTimeout(1200);
  const g2Size = await G2.evaluate(() => boardSize);
  assert(g2Size === 13, '加入者按房间 13 路建盘 (boardSize=' + g2Size + ')');
  const b13 = await H2.locator('#board').boundingBox();
  const b13g = await G2.locator('#board').boundingBox();
  assert(Math.abs(b13.width - b13g.width) < 2, '双方画布尺寸一致 (13 路)');
  // 13 路棋盘边缘落子（0,0）也能同步
  await H2.locator('#board').click({ position: { x: 21, y: 21 } });
  await H2.waitForTimeout(500);
  const g2Count = await G2.evaluate(() => moveCount);
  assert(g2Count === 1, '13 路棋盘边缘落子同步到对方 (moveCount=' + g2Count + ')');

  console.log('== 10. 联机中修改棋盘大小（房主未开局，双方同步） ==');
  const H3 = await ctxHost.newPage();
  await H3.goto(BASE, { waitUntil: 'load' });
  await skipGuess(H3);
  await H3.click('#btnOnline');
  await H3.waitForTimeout(300);
  await H3.locator('#guessFirstToggle').uncheck();          // 关猜先：本节固定黑白
  await H3.click('#btnCreateRoom');                         // 默认 19 路建房
  await H3.waitForTimeout(800);
  const inviteH3 = (await H3.locator('#inviteLinkInput').inputValue()).trim();
  const G3 = await ctxGuest.newPage();
  await G3.goto(inviteH3, { waitUntil: 'load' });
  await skipGuess(G3);
  await G3.waitForTimeout(1200);
  const h3Size0 = await H3.evaluate(() => boardSize);
  assert(h3Size0 === 19, 'H3 以 19 路建房');
  // 房主在对局开始前把棋盘改为 13 路 → 双方同步重建
  await H3.selectOption('#boardSizeSelect', '13');
  await H3.waitForTimeout(800);
  const h3Size = await H3.evaluate(() => boardSize);
  const g3Size = await G3.evaluate(() => boardSize);
  assert(h3Size === 13 && g3Size === 13, '房主改棋盘大小后双方同步为 13 路 (h=' + h3Size + ', g=' + g3Size + ')');
  // 落子后房主仍可修改棋盘大小（改大小 = 双方清空重开）
  await H3.locator('#board').click({ position: { x: 21, y: 21 } });   // 13 路 (0,0)
  await H3.waitForTimeout(500);
  const sizeHostCanStillEdit = !(await H3.locator('#boardSizeSelect').isDisabled());
  assert(sizeHostCanStillEdit, '落子后房主仍可修改棋盘大小（改大小即重开）');
  await G3.waitForTimeout(500);
  assert((await G3.evaluate(() => moveCount)) === 1, '改大小后落子仍正常同步');
  // 对局中改回 19 路 → 双方清空重开
  await H3.selectOption('#boardSizeSelect', '19');
  await H3.waitForTimeout(800);
  await G3.waitForTimeout(800);
  const h3Size2 = await H3.evaluate(() => boardSize);
  const g3Size2 = await G3.evaluate(() => boardSize);
  assert(h3Size2 === 19 && g3Size2 === 19, '对局中改大小双方同步为 19 路 (h=' + h3Size2 + ', g=' + g3Size2 + ')');
  const h3Count = await H3.evaluate(() => moveCount);
  const g3Count = await G3.evaluate(() => moveCount);
  assert(h3Count === 0 && g3Count === 0, '改大小后双方棋盘清空重开 (h=' + h3Count + ', g=' + g3Count + ')');
  await H3.close(); await G3.close();

  console.log('== 11. 昵称同步 + 聊天快捷语 + 未读角标 ==');
  await host.locator('#nicknameInput').fill('棋圣小明');
  await host.locator('#nicknameInput').press('Enter');
  await guest.waitForTimeout(800);
  const gPeerNameNick = (await guest.locator('#peerPlayerName').textContent()).trim();
  assert(gPeerNameNick.includes('棋圣小明'), '对方玩家栏显示我的昵称: ' + gPeerNameNick);
  // 快捷语：guest 折叠聊天时 host 发快捷消息 → guest 按钮点亮 + 未读角标出现
  const chatExpanded = await guest.locator('#chatWrap').evaluate((el) => el.style.display !== 'none');
  if (chatExpanded) await guest.locator('#btnChatToggle').click();   // 先收起，制造折叠场景
  await guest.waitForTimeout(300);
  const chatCollapsed = await guest.locator('#chatWrap').evaluate((el) => el.style.display === 'none');
  assert(chatCollapsed, '对方聊天面板处于折叠状态');
  await host.locator('#chatQuickRow button[data-quick="该你了"]').click();
  await guest.waitForTimeout(800);
  const badgeVisible = await guest.locator('#chatBadge').isVisible();
  const badgeText = (await guest.locator('#chatBadge').textContent()).trim();
  assert(badgeVisible && Number(badgeText) >= 1, '折叠时收到消息出现未读角标: ' + badgeText);
  await guest.locator('#btnChatToggle').click();                    // 展开 → 角标清零
  await guest.waitForTimeout(400);
  const badgeHidden = await guest.locator('#chatBadge').evaluate((el) => el.style.display === 'none');
  const gQuickText = (await guest.locator('#chatLog').textContent()).trim();
  assert(badgeHidden && gQuickText.includes('该你了'), '展开聊天后面板显示快捷语且角标清零');

  console.log('== 12. 语音/视频通话（WebRTC 假设备全流程） ==');
  await host.locator('#btnCallAudio').click();                     // 房主发起语音
  await host.waitForTimeout(800);
  const callStatusOut = (await host.locator('#callStatus').textContent()).trim();
  assert(/正在呼叫/.test(callStatusOut), '发起方进入呼叫状态: ' + callStatusOut);
  await guest.waitForTimeout(800);                                  // 等对方收到并处理来电
  const incomingVisible = await guest.locator('#incomingCall').isVisible();
  const incomingText = (await guest.locator('#incomingText').textContent()).trim();
  assert(incomingVisible && /语音通话/.test(incomingText), '对方弹出语音来电横幅: ' + incomingText);
  await guest.locator('#btnAcceptCall').click();                    // 接听
  await host.waitForTimeout(1500);
  await guest.waitForTimeout(1500);
  const hCallActive = await host.evaluate(() => callState);
  const gCallActive = await guest.evaluate(() => callState);
  assert(hCallActive === 'active' && gCallActive === 'active', '双方进入通话状态 (callState=active)');
  const callAreaVisible = await host.locator('#callArea').isVisible();
  assert(callAreaVisible, '通话控制区显示');
  await host.locator('#btnMuteAudio').click();                      // 静音
  const mutedState = await host.locator('#btnMuteAudio').textContent();
  assert(/已静音/.test(mutedState), '静音开关生效: ' + mutedState);
  await host.locator('#btnHangupCall').click();                     // 挂断
  await host.waitForTimeout(600);
  await guest.waitForTimeout(600);
  const hCallIdle = await host.evaluate(() => callState);
  const gCallIdle = await guest.evaluate(() => callState);
  assert(hCallIdle === 'idle' && gCallIdle === 'idle', '挂断后双方回到空闲状态');

  console.log('== 13. 对方离开 → 房间保留可重新邀请 ==');
  await guest.locator('#btnLeaveRoom').click();                     // 对方主动断开
  await host.waitForTimeout(900);
  const hostLeftStatus = (await host.locator('#onlineStatus').textContent()).trim();
  assert(/对方已离开/.test(hostLeftStatus), '房主收到对方离开提示（房间保留）: ' + hostLeftStatus);
  const inviteBackVisible = await host.locator('#inviteRow').isVisible();
  assert(inviteBackVisible, '房主侧邀请区重新出现');
  // 新对方用同一邀请链接重新加入 → 恢复原棋局（第 6 节重开后已落 1 手）
  const G4 = await ctxGuest.newPage();
  await G4.goto(inviteVal, { waitUntil: 'load' });
  await skipGuess(G4);
  await G4.waitForTimeout(1500);
  const g4Count = await G4.evaluate(() => moveCount);
  assert(g4Count === 1, '新对方加入后恢复原棋局 (moveCount=' + g4Count + ')');
  await host.waitForTimeout(600);
  const hostRejoinStatus = (await host.locator('#onlineStatus').textContent()).trim();
  assert(/对局开始/.test(hostRejoinStatus), '房主确认对方重新加入: ' + hostRejoinStatus);
  await G4.close();


  console.log('== 14. 联机公平猜先（默认开启，颜色与角色解耦） ==');
  const H4 = await ctxHost.newPage();
  await H4.goto(BASE, { waitUntil: 'load' });
  await skipGuess(H4);
  await H4.click('#btnOnline');
  await H4.waitForTimeout(400);
  const guessToggleEnabled = !(await H4.locator('#guessFirstToggle').isDisabled());
  assert(guessToggleEnabled, '联机模式入房前可开关“开局猜先”');
  assert(await H4.locator('#guessFirstToggle').isChecked(), '联机猜先默认开启（公平决定谁执黑）');
  await H4.click('#btnCreateRoom');
  await H4.waitForTimeout(800);
  const inviteH4 = (await H4.locator('#inviteLinkInput').inputValue()).trim();
  const G5 = await ctxGuest.newPage();
  await G5.goto(inviteH4, { waitUntil: 'load' });
  await skipGuess(G5);
  await G5.waitForTimeout(1200);
  await completeOnlineGuess(H4, G5);
  const h4Color = await H4.evaluate(() => myColor);
  const g5Color = await G5.evaluate(() => myColor);
  assert((h4Color === 1 || h4Color === 2) && (g5Color === 1 || g5Color === 2), '猜先后双方都获得执子颜色');
  assert(h4Color !== g5Color, '双方颜色互补（一黑一白，赢家决定）');
  const modalClosed = await H4.locator('#onlineGuessModal').evaluate((el) => el.style.display === 'none');
  assert(modalClosed, '猜先完成后弹窗关闭');
  const blackPage = h4Color === 1 ? H4 : G5;   // 执黑者先手
  await blackPage.locator('#board').click({ position: { x: 21, y: 21 } });   // (0,0)
  await H4.waitForTimeout(600);
  await G5.waitForTimeout(600);
  const h4Count = await H4.evaluate(() => moveCount);
  const g5Count = await G5.evaluate(() => moveCount);
  assert(h4Count === 1 && g5Count === 1, '执黑者先手落子，双方棋盘同步 (moveCount=1)');
  await H4.close(); await G5.close();

  const ok = errs.length === 0;
  console.log('页面错误: ' + (errs.length ? errs.join(' | ') : '无'));
  console.log('\nE2E RESULT: ' + (ok ? 'PASS' : 'FAIL') + '（共 ' + passed + ' 项断言）');
  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('E2E ERROR: ' + e.message); process.exit(2); }).finally(() => {
  setTimeout(() => { serverProc.kill(); }, 200);
});
