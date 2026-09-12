// 核实：引擎在空盘 / 中盘局面下到底怎么决策，耗时多少。
'use strict';
const path = require('path');
const A = require(path.join(__dirname, '..', 'outputs', 'engine', 'gomoku-ai.js'));
const S = 19, EMPTY = 0, BLACK = 1, WHITE = 2;
A.setMoveVariety(0);
A.setBoardSize(S);
A.setColors(BLACK, WHITE);

function clear() { for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) A.board[r][c] = EMPTY; }

console.log('--- 空盘，黑先 ---');
clear();
let t = Date.now();
let mv = A.getBestMove('hard', BLACK);
console.log('  hard 落点', JSON.stringify(mv), Date.now() - t + 'ms');
t = Date.now();
mv = A.getBestMove('medium', BLACK);
console.log('  medium 落点', JSON.stringify(mv), Date.now() - t + 'ms');
t = Date.now();
mv = A.getBestMove('easy', BLACK);
console.log('  easy 落点', JSON.stringify(mv), Date.now() - t + 'ms');

console.log('--- 有棋子（各 6 子）---');
clear();
const cells = [[9,9],[10,9],[9,10],[10,10],[8,9],[11,9],[9,8],[11,10],[8,10],[10,8],[8,8],[11,11]];
cells.forEach(([r,c],i)=>{ A.board[r][c] = i%2===0?BLACK:WHITE; });
t = Date.now();
mv = A.getBestMove('hard', BLACK);
console.log('  hard 落点', JSON.stringify(mv), Date.now() - t + 'ms（应该 >100ms，因为会跑搜索）');
t = Date.now();
mv = A.getBestMove('medium', BLACK);
console.log('  medium 落点', JSON.stringify(mv), Date.now() - t + 'ms');

console.log('--- 直接跑一局自对弈，看每步是否都极快 ---');
clear();
A.board[9][9] = BLACK;
let stones = 1;
const times = [];
while (stones < 60) {
  const color = stones % 2 === 1 ? WHITE : BLACK;
  const t0 = Date.now();
  const m = A.getBestMove('hard', color);
  times.push(Date.now() - t0);
  if (!m || A.board[m[0]][m[1]] !== EMPTY) { console.log('  非法落点', JSON.stringify(m)); break; }
  A.board[m[0]][m[1]] = color;
  stones++;
}
console.log('  手数', stones, ' 耗时序列前 20:', times.slice(0, 20).join(','));
console.log('  最大耗时', Math.max(...times), 'ms  平均', Math.round(times.reduce((a,b)=>a+b,0)/times.length), 'ms');
