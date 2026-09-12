// 深入诊断：搜索为什么给出远比评估差的落点？
'use strict';
const path = require('path');
const A = require(path.join(__dirname, '..', 'outputs', 'engine', 'gomoku-ai.js'));
const BLACK = 1, WHITE = 2, EMPTY = 0;
A.setMoveVariety(0);
A.setBoardSize(19);
A.setColors(WHITE, BLACK);

function setup(stones) {
  const b = A.board;
  for (let r = 0; r < 19; r++) for (let c = 0; c < 19; c++) b[r][c] = EMPTY;
  for (const [color, cells] of Object.entries(stones)) for (const [r, c] of cells) b[r][c] = Number(color);
}

/* 第二题：黑活三 (0,2)(0,3)(0,4)，落 (0,1) 或 (0,5) 即活四（threatLevel=3） */
setup({ 1: [[0, 2], [0, 3], [0, 4]], 2: [[5, 5], [6, 6]] });
console.log('=== 局面：黑活三 (0,2)(0,3)(0,4)，轮黑；落 (0,1)/(0,5) 成活四 ===');
console.log('findImmediateWin(黑) =', JSON.stringify(A.findImmediateWin(BLACK)), '(一步成五，应为 null)');
console.log('findDoubleThreat(黑) =', JSON.stringify(A.findDoubleThreat(BLACK)));
console.log('findDoubleKill(黑)   =', JSON.stringify(A.findDoubleKill(BLACK)));
console.log('findVcfWin(黑)       =', JSON.stringify(A.findVcfWin(BLACK)));
console.log('findVctWin(黑)       =', JSON.stringify(A.findVctWin(BLACK)));
console.log('threatLevel(0,1,黑)  =', A.threatLevel(0, 1, BLACK), ' field check (0,1) 空?', A.board[0][1] === EMPTY);

/* 手工模拟根搜索：为每个候选落子跑一次 minimax 同款的深度搜索，看返回分 */
console.log('\n--- 手工根搜索复现（medium：深度 3）---');
function searchRoot(depth, budgetMs) {
  const results = [];
  const cands = [[0, 1], [0, 5], [7, 7], [1, 4], [1, 2], [5, 6], [4, 5]];
  for (const [r, c] of cands) {
    if (A.board[r][c] !== EMPTY) continue;
    A.board[r][c] = BLACK;
    const before = A.evaluateBoard(BLACK, WHITE, 1, null);
    A.board[r][c] = EMPTY;
    results.push({ move: [r, c], staticEval: before, threat: A.threatLevel(r, c, BLACK) });
  }
  return results;
}
for (const row of searchRoot()) {
  console.log(`  (${row.move}) threat=${row.threat} 静态评估=${row.staticEval}`);
}

console.log('\n--- 引擎实际落点与耗时 ---');
for (const lv of ['medium', 'hard']) {
  const t0 = Date.now();
  const mv = A.getBestMove(lv, BLACK);
  console.log(`  ${lv.padEnd(7)} → ${JSON.stringify(mv)}  (${Date.now() - t0}ms)`);
}

console.log('\n--- 关键怀疑点：候选列表是否包含活四点？---');
/* 复现 tacticalCandidates 的逻辑（引擎未导出，这里按同样规则手工算） */
setup({ 1: [[0, 2], [0, 3], [0, 4]], 2: [[5, 5], [6, 6]] });
console.log('  (0,1) 是否为空且合法:', A.board[0][1] === EMPTY);
console.log('  (0,5) 是否为空且合法:', A.board[0][5] === EMPTY);
console.log('  findDoubleKill 返回:', JSON.stringify(A.findDoubleKill(BLACK)), '（空数组/点？）');
