// 最小化复现：黑占 (9,9) 后轮白，引擎返回了什么？
'use strict';
const path = require('path');
const A = require(path.join(__dirname, '..', 'outputs', 'engine', 'gomoku-ai.js'));
const S = 19, EMPTY = 0, BLACK = 1, WHITE = 2;

A.setMoveVariety(0);
A.setBoardSize(S);
A.setColors(BLACK, WHITE);

function clear() { for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) A.board[r][c] = EMPTY; }
const dump = () => {
  const out = [];
  for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) if (A.board[r][c]) out.push(`${r},${c}=${A.board[r][c]}`);
  return out.join(' ') || '(空)';
};

console.log('=== 场景 A：空盘，黑先 ===');
clear();
console.log('  getBestMove(hard, BLACK) =', JSON.stringify(A.getBestMove('hard', BLACK)), ' 盘面:', dump());

console.log('=== 场景 B：黑占天元后，轮白 ===');
clear();
A.board[9][9] = BLACK;
console.log('  落子前盘面:', dump());
console.log('  board[9][9] =', A.board[9][9]);
const mv = A.getBestMove('hard', WHITE);
console.log('  getBestMove(hard, WHITE) =', JSON.stringify(mv));
if (mv) console.log('  该点 board 值 =', A.board[mv[0]][mv[1]], '（0=空，应当是 0）');
console.log('  落子后盘面:', dump());

console.log('=== 场景 C：多个子，轮黑 ===');
clear();
A.board[9][9] = BLACK; A.board[9][10] = WHITE;
console.log('  getBestMove(hard, BLACK) =', JSON.stringify(A.getBestMove('hard', BLACK)));
console.log('  盘面:', dump());

console.log('=== 场景 D：逐一检查 easy/medium 档 ===');
clear();
A.board[9][9] = BLACK;
for (const lv of ['easy', 'medium', 'hard']) {
  const m = A.getBestMove(lv, WHITE);
  console.log(`  ${lv.padEnd(7)} → ${JSON.stringify(m)} 该点值=${m ? A.board[m[0]][m[1]] : 'null'}`);
}

console.log('=== 场景 E：调用 findImmediateWin / bookMove 单看 ===');
clear();
A.board[9][9] = BLACK;
console.log('  findImmediateWin(WHITE) =', JSON.stringify(A.findImmediateWin(WHITE)));
console.log('  bookMove("hard", WHITE) =', JSON.stringify(A.bookMove('hard', WHITE)));
console.log('  bookMove("hard", BLACK) =', JSON.stringify(A.bookMove('hard', BLACK)));
console.log('  openingMove("hard")     =', JSON.stringify(A.openingMove('hard')));
console.log('  findDoubleKill(WHITE)   =', JSON.stringify(A.findDoubleKill(WHITE)));
console.log('  resolveThreats(...)     =', JSON.stringify(A.resolveThreats(WHITE, BLACK, false, false)));
