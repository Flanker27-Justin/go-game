// 诊断：P0-2 后为什么弃用明显更好的活三扩展点，而走到无关位置？
'use strict';
const path = require('path');
const A = require(path.join(__dirname, '..', 'outputs', 'engine', 'gomoku-ai.js'));
const BLACK = 1, WHITE = 2, EMPTY = 0;
A.setMoveVariety(0);
A.setBoardSize(19);
A.setColors(WHITE, BLACK);   // AI(黑) vs 玩家(白)

function setup(stones) {
  const b = A.board;
  for (let r = 0; r < 19; r++) for (let c = 0; c < 19; c++) b[r][c] = EMPTY;
  for (const [color, cells] of Object.entries(stones)) for (const [r, c] of cells) b[r][c] = Number(color);
}

/* 题库里失败的题：自己活三应当进攻 */
setup({ 1: [[10, 5], [10, 6]], 2: [[2, 2], [2, 3]] });
console.log('局面：黑(10,5)(10,6) 活二；白 (2,2)(2,3)；轮黑');
console.log('  threatLevel(10,4,黑) =', A.threatLevel(10, 4, BLACK), '(1=活三)');
console.log('  threatLevel(10,7,黑) =', A.threatLevel(10, 7, BLACK));
console.log('  threatLevel(9,6,黑)  =', A.threatLevel(9, 6, BLACK));
console.log('  threatLevel(7,7,黑)  =', A.threatLevel(7, 7, BLACK));
console.log('  evaluateCell(10,4,黑) =', A.evaluateCell(10, 4, BLACK));
console.log('  evaluateCell(9,6,黑)  =', A.evaluateCell(9, 6, BLACK));
console.log('  候选点（getBestMove 前先看威胁）:');
console.log('  medium 落点 =', JSON.stringify(A.getBestMove('medium', BLACK)));
console.log('  hard   落点 =', JSON.stringify(A.getBestMove('hard', BLACK)));
console.log('  easy   落点 =', JSON.stringify(A.getBestMove('easy', BLACK)));

console.log('\n各候选“落子后的全盘评估”（黑视角，越高越好）:');
for (const [r, c] of [[10, 4], [10, 7], [10, 3], [10, 8], [9, 6], [7, 7], [11, 6]]) {
  if (A.board[r][c] !== EMPTY) continue;
  A.board[r][c] = BLACK;
  const ev = A.evaluateBoard(BLACK, WHITE, 1, null);
  const tl = A.threatLevel(r, c, BLACK);
  A.board[r][c] = EMPTY;
  console.log(`  (${r},${c}) threatLevel=${tl} → evaluateBoard=${ev}`);
}

/* 第二题：角部活三 */
setup({ 1: [[0, 2], [0, 3], [0, 4]], 2: [[5, 5], [6, 6]] });
console.log('\n第二题：黑角部活三 (0,2)(0,3)(0,4)，轮黑');
console.log('  threatLevel(0,1,黑) =', A.threatLevel(0, 1, BLACK));
console.log('  threatLevel(0,5,黑) =', A.threatLevel(0, 5, BLACK));
console.log('  medium 落点 =', JSON.stringify(A.getBestMove('medium', BLACK)));
console.log('  hard   落点 =', JSON.stringify(A.getBestMove('hard', BLACK)));
for (const [r, c] of [[0, 1], [0, 5], [7, 7], [1, 4]]) {
  if (A.board[r][c] !== EMPTY) continue;
  A.board[r][c] = BLACK;
  const ev = A.evaluateBoard(BLACK, WHITE, 1, null);
  A.board[r][c] = EMPTY;
  console.log(`  (${r},${c}) threatLevel=${A.threatLevel(r, c, BLACK)} → evaluateBoard=${ev}`);
}
