// 用 ai-threat-test 里的原始局面复现 VCF/VCT 的失败
'use strict';
const path = require('path');
const A = require(path.join(__dirname, '..', 'outputs', 'engine', 'gomoku-ai.js'));
const BLACK = 1, WHITE = 2, EMPTY = 0;
A.setBoardSize(19);
A.setMoveVariety(0);

function reset() { const b = A.board; for (let r = 0; r < 19; r++) for (let c = 0; c < 19; c++) b[r][c] = EMPTY; }
function put(color, cells) { for (const [r, c] of cells) A.board[r][c] = color; }

console.log('=== 场景11 局面：白 VCF（期望 (10,6)）===');
reset();
put(BLACK, [[10, 2], [2, 2], [2, 3]]);
put(WHITE, [[10, 3], [10, 4], [10, 5], [8, 4], [9, 5]]);
A.setColors(BLACK, WHITE);
console.log('  findImmediateWin(白) =', JSON.stringify(A.findImmediateWin(WHITE)));
console.log('  findVcfWin(白)       =', JSON.stringify(A.findVcfWin(WHITE)));
console.log('  threatLevel(10,6,白) =', A.threatLevel(10, 6, WHITE), '（应为 2=冲四）');
console.log('  evaluateCell(10,6,白)=', A.evaluateCell(10, 6, WHITE));
console.log('  getBestMove(medium)  =', JSON.stringify(A.getBestMove('medium', WHITE)));
console.log('  getBestMove(hard)    =', JSON.stringify(A.getBestMove('hard', WHITE)));

console.log('\n=== 场景27 局面：黑 VCT 双三（期望 (9,9)）===');
reset();
put(BLACK, [[9, 8], [9, 10], [8, 9], [10, 9]]);
put(WHITE, [[2, 2], [2, 3], [17, 17]]);
A.setColors(WHITE, BLACK);
console.log('  threatLevel(9,9,黑)  =', A.threatLevel(9, 9, BLACK), '（落子前应为 0）');
console.log('  countThreats(9,9,黑) =', A.countThreats(9, 9, BLACK), '（应为 2）');
console.log('  findVctWin(黑)       =', JSON.stringify(A.findVctWin(BLACK)));
console.log('  findDoubleKill(黑)   =', JSON.stringify(A.findDoubleKill(BLACK)));
console.log('  getBestMove(medium)  =', JSON.stringify(A.getBestMove('medium', BLACK)));
console.log('  getBestMove(hard)    =', JSON.stringify(A.getBestMove('hard', BLACK)));

console.log('\n=== 深度函数现状 ===');
console.log('  searchDepth()（空盘） =', A.searchDepth());
reset(); put(BLACK, Array.from({ length: 40 }, (_, i) => [3 + Math.floor(i / 19), i % 19]));
console.log('  searchDepth()（40 子）=', A.searchDepth());
