// 用全新引擎进程验证同一局面：排除 TT / 多次调用带来的污染
'use strict';
const path = require('path');
const A = require(path.join(__dirname, '..', 'outputs', 'engine', 'gomoku-ai.js'));
const BLACK = 1, WHITE = 2, EMPTY = 0;

A.setMoveVariety(0);
A.setBoardSize(19);
A.setColors(WHITE, BLACK);
const b = A.board;
for (let r = 0; r < 19; r++) for (let c = 0; c < 19; c++) b[r][c] = EMPTY;
b[0][2] = BLACK; b[0][3] = BLACK; b[0][4] = BLACK;
b[5][5] = WHITE; b[6][6] = WHITE;

console.log('首次调用 medium:', JSON.stringify(A.getBestMove('medium', BLACK)));
console.log('首次调用 hard  :', JSON.stringify(A.getBestMove('hard', BLACK)));

/* 再换一个“黑活三在别处”的局面，确认不是坐标特例 */
for (let r = 0; r < 19; r++) for (let c = 0; c < 19; c++) b[r][c] = EMPTY;
b[10][8] = BLACK; b[10][9] = BLACK; b[10][10] = BLACK;
b[3][3] = WHITE; b[4][4] = WHITE;
console.log('\n局面2（黑活三 (10,8)(10,9)(10,10)，活四点 (10,7)/(10,11)）:');
console.log('  threatLevel(10,7,黑)=', A.threatLevel(10, 7, BLACK), ' (10,11)=', A.threatLevel(10, 11, BLACK));
console.log('  findVcfWin(黑)=', JSON.stringify(A.findVcfWin(BLACK)));
console.log('  medium:', JSON.stringify(A.getBestMove('medium', BLACK)));
console.log('  hard  :', JSON.stringify(A.getBestMove('hard', BLACK)));

/* 第三个局面：只有活二（无直接活四），看搜索是否会正常选活三点 */
for (let r = 0; r < 19; r++) for (let c = 0; c < 19; c++) b[r][c] = EMPTY;
b[10][5] = BLACK; b[10][6] = BLACK;
b[2][2] = WHITE; b[2][3] = WHITE;
console.log('\n局面3（黑活二 (10,5)(10,6)）:');
console.log('  medium:', JSON.stringify(A.getBestMove('medium', BLACK)), '(期望 (10,4) 或 (10,7))');
console.log('  hard  :', JSON.stringify(A.getBestMove('hard', BLACK)));
