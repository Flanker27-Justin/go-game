// 关键诊断：开局库的“评分地基”有多浅？
// 取开局第 3 手（黑方第二手），列出全部候选点及其深度 3 搜索得分，
// 看分数差距是“明确优劣”还是“几乎无差别（噪声）”。
'use strict';
const path = require('path');
const A = require(path.join(__dirname, '..', 'outputs', 'engine', 'gomoku-ai.js'));
const BLACK = 1, WHITE = 2, EMPTY = 0;
const S = 19;
A.setMoveVariety(0);
A.setBoardSize(S);
A.setColors(WHITE, BLACK);

function clear() { const b = A.board; for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) b[r][c] = EMPTY; }

/* 局面：黑(9,9) 白(8,9)，轮到黑 */
clear();
A.board[9][9] = BLACK;
A.board[8][9] = WHITE;

/* 库内黑方在此局面的应答（镜像规范化后的键：黑天元 + 白在其上方 → 相对坐标
 * 黑(0,0)、白(-1,0)，即 B|-1,0,2;0,0,1） */
const book = require(path.join(__dirname, '..', 'outputs', 'engine', 'opening-book.json'));
const entry = book['B|-1,0,2;0,0,1'];
console.log('库内该局面（黑天元、白在其上一格）的应答:', JSON.stringify(entry));

/* 逐点用搜索评估：这里用“落子后的静态评估 + 深度 3 搜索返回分”两种视角 */
console.log('\n黑方候选点及其“落子后黑视角静态评估”（越大越好）:');
const list = [];
for (let r = 7; r <= 11; r++) {
  for (let c = 7; c <= 11; c++) {
    if (A.board[r][c] !== EMPTY) continue;
    A.board[r][c] = BLACK;
    const ev = A.evaluateBoard(BLACK, WHITE, 1, WHITE);   // 落子后轮到白
    A.board[r][c] = EMPTY;
    list.push({ mv: [r, c], ev });
  }
}
list.sort((a, b) => b.ev - a.ev);
for (const x of list) {
  console.log(`  (${x.mv})  ${String(Math.round(x.ev)).padStart(9)}`);
}
const top = list[0].ev, last = list[list.length - 1].ev;
console.log(`\n最高与最低相差 ${Math.round(top - last)}（相对最高值 ${((top - last) / Math.abs(top) * 100).toFixed(1)}%）`);
console.log(`前 5 名是否都在库内应答里？库内: ${JSON.stringify(entry ? entry.map(e => [9 + e[0], 9 + e[1]]) : [])}`);
const bookMoves = entry ? entry.map(e => `${9 + e[0]},${9 + e[1]}`) : [];
const top5 = list.slice(0, 5).map(x => x.mv.join(','));
console.log('  静态评估前 5:', top5.join(' | '));
console.log('  库里给的应答:', bookMoves.join(' | '));
console.log('  重合数:', top5.filter(m => bookMoves.includes(m)).length, '/', top5.length);

/* 直接问引擎：这个局面它自己会走哪（hard，会跑搜索） */
clear();
A.board[9][9] = BLACK;
A.board[8][9] = WHITE;
const t0 = Date.now();
const mv = A.getBestMove('hard', BLACK);
console.log(`\n引擎实际选择(hard): ${JSON.stringify(mv)}  (${Date.now() - t0}ms)`);
const t1 = Date.now();
const mv2 = A.getBestMove('medium', BLACK);
console.log(`引擎实际选择(medium): ${JSON.stringify(mv2)}  (${Date.now() - t1}ms)`);
