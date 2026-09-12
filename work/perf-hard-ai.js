// 困难档性能基准：19 路 AI 自对弈，统计每步耗时与单步上限。
// 迁移说明：引擎已独立成模块（outputs/engine/gomoku-ai.js），本脚本直接 require，
// 不再从 gomoku.html 正则抠函数。
// 用法: node work/perf-hard-ai.js [局数]
'use strict';
const path = require('path');
const S = 19;
const A = require(path.join(__dirname, '..', 'outputs', 'engine', 'gomoku-ai.js'));
const { EMPTY, BLACK, WHITE } = A;

A.setMoveVariety(0);          // 关闭随机，保证可复现
A.setBoardSize(S);
A.setColors(BLACK, WHITE);    // 双方都按 hard 决策，颜色只影响视角

const board = A.board;
function reset() { for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) board[r][c] = EMPTY; }
function hasFive(r, c, color) {
  for (const [dr, dc] of A.DIRECTIONS) {
    let n = 1;
    for (const k of [1, -1]) for (let i = 1; i < 5; i++) {
      const rr = r + dr * i * k, cc = c + dc * i * k;
      if (rr < 0 || rr >= S || cc < 0 || cc >= S || board[rr][cc] !== color) break;
      n++;
    }
    if (n >= 5) return true;
  }
  return false;
}

function playGame() {
  reset();
  const times = [];
  const moves = [];
  let winner = null;
  board[9][9] = BLACK;
  let stones = 1;
  const MAX_PLIES = 150;
  while (stones < S * S && stones < MAX_PLIES) {
    const color = stones % 2 === 1 ? WHITE : BLACK;
    const t0 = Date.now();
    const mv = A.getBestMove('hard', color);
    const dt = Date.now() - t0;
    let r, c, ok = false;
    if (mv && board[mv[0]] && board[mv[0]][mv[1]] === EMPTY) { r = mv[0]; c = mv[1]; ok = true; }
    if (!ok) {
      for (let rad = 1; rad < S && !ok; rad++)
        for (let dr = -rad; dr <= rad && !ok; dr++)
          for (let dc = -rad; dc <= rad && !ok; dc++) {
            const rr = 9 + dr, cc = 9 + dc;
            if (rr >= 0 && rr < S && cc >= 0 && cc < S && board[rr][cc] === EMPTY) { r = rr; c = cc; ok = true; }
          }
    }
    board[r][c] = color;
    stones++;
    times.push(dt);
    moves.push({ ply: stones, color: color === BLACK ? 'B' : 'W', cell: [r, c], ms: dt });
    if (hasFive(r, c, color)) { winner = color === BLACK ? 'BLACK' : 'WHITE'; break; }
  }
  return { times, moves, winner, plies: stones };
}

const GAMES = Number(process.argv[2] || 10);
const allTimes = [];
console.log(`==== 困难档性能基准：${GAMES} 局 19 路 AI 自对弈 ====`);
for (let g = 1; g <= GAMES; g++) {
  const res = playGame();
  allTimes.push(...res.times);
  const maxT = Math.max(...res.times);
  const overB = res.times.filter(t => t > 2500).length;
  const over3 = res.times.filter(t => t > 3000).length;
  const mid = res.moves.filter(m => m.ply >= 35 && m.ply <= 60);
  const late = res.moves.filter(m => m.ply >= 60);
  console.log(`局${g}: ${res.plies} 手, 胜方=${res.winner}, 最大 ${maxT}ms, >2500ms ${overB} 次, >3000ms ${over3} 次, ` +
    `中盘(35-60)最大 ${mid.length ? Math.max(...mid.map(m => m.ms)) : 0}ms, 残局(60+)最大 ${late.length ? Math.max(...late.map(m => m.ms)) : 0}ms`);
}
const overallMax = Math.max(...allTimes);
const avg = Math.round(allTimes.reduce((a, b) => a + b, 0) / allTimes.length);
console.log(`\n合计 ${allTimes.length} 步，平均 ${avg}ms，最大 ${overallMax}ms，>2500ms ${allTimes.filter(t => t > 2500).length} 次，>3000ms ${allTimes.filter(t => t > 3000).length} 次`);
console.log(overallMax <= 3000 ? 'PERF PASS（单步均不超过 3000ms）' : 'PERF FAIL（存在超过 3000ms 的单步）');
process.exit(overallMax <= 3000 ? 0 : 1);
