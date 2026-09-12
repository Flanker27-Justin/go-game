// 诊断：改造后 findVcfWin / findVctWin 为何返回 null？
'use strict';
const path = require('path');
const A = require(path.join(__dirname, '..', 'outputs', 'engine', 'gomoku-ai.js'));
const BLACK = 1, WHITE = 2, EMPTY = 0;

A.setBoardSize(19);
A.setMoveVariety(0);

/** 场景：VCF 2 层强制胜（取自 ai-threat-test 的场景11） */
function setupVcf() {
  const b = A.board;
  for (let r = 0; r < 19; r++) for (let c = 0; c < 19; c++) b[r][c] = EMPTY;
  /* 黑：横向冲四 + 另一处冲四资源，白挡住即可连杀 —— 与测试脚本一致 */
  b[10][5] = WHITE; b[10][6] = WHITE; b[10][7] = WHITE; b[10][8] = WHITE;
  b[10][4] = EMPTY;
  b[9][6] = WHITE; b[9][7] = WHITE; b[9][8] = WHITE;
  b[11][6] = BLACK; b[11][7] = BLACK;
}
/** VCT 双三链杀（场景27） */
function setupVct() {
  const b = A.board;
  for (let r = 0; r < 19; r++) for (let c = 0; c < 19; c++) b[r][c] = EMPTY;
  b[9][7] = BLACK; b[9][8] = BLACK; b[9][10] = BLACK; b[10][9] = BLACK; b[8][9] = BLACK;
}

console.log('--- 直接调用（未先做任何搜索）---');
setupVcf();
console.log('  findVcfWin(WHITE) =', JSON.stringify(A.findVcfWin(WHITE)));
setupVct();
console.log('  findVctWin(BLACK) =', JSON.stringify(A.findVctWin(BLACK)));

console.log('\n--- 先调用一次 getBestMove 触发增量状态同步，再调用 ---');
setupVcf();
A.setColors(BLACK, WHITE);
A.getBestMove('medium', WHITE);          // 触发 ensureEvalState
console.log('  findVcfWin(WHITE) =', JSON.stringify(A.findVcfWin(WHITE)));
setupVct();
A.getBestMove('medium', BLACK);
console.log('  findVctWin(BLACK) =', JSON.stringify(A.findVctWin(BLACK)));

console.log('\n--- 直接改写棋盘后立即调用（模拟测试脚本的用法）---');
setupVct();
const mv = A.getBestMove('hard', BLACK);
console.log('  getBestMove(hard, BLACK) =', JSON.stringify(mv));
console.log('  findVctWin(BLACK) =', JSON.stringify(A.findVctWin(BLACK)));

console.log('\n--- 增量结构自检 ---');
if (typeof A.evalStats === 'function') {
  const st = A.evalStats();
  console.log('  lineSum =', JSON.stringify(st.lineSum), ' fiveCnt =', JSON.stringify(st.fiveCnt));
} else {
  console.log('  （无 evalStats 导出）');
}
