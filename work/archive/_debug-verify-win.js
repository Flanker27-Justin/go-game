// 复核：上面 playout 里“黑 14 手胜”是怎么赢的？打印完整盘面与最后五连。
'use strict';
const path = require('path');
const A = require(path.join(__dirname, '..', 'outputs', 'engine', 'gomoku-ai.js'));
const BLACK = 1, WHITE = 2, EMPTY = 0;
const S = 19;
A.setMoveVariety(0);
A.setBoardSize(S);
A.setColors(WHITE, BLACK);

function hasFive(r, c, color) {
  for (const [dr, dc] of A.DIRECTIONS) {
    let n = 1;
    for (const k of [1, -1]) for (let i = 1; i < 5; i++) {
      const rr = r + dr * i * k, cc = c + dc * i * k;
      if (rr < 0 || rr >= S || cc < 0 || cc >= S || A.board[rr][cc] !== color) break;
      n++;
    }
    if (n >= 5) return true;
  }
  return false;
}

const b = A.board;
for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) b[r][c] = EMPTY;
for (const [r, c] of [[10, 5], [10, 6], [8, 7], [9, 7]]) b[r][c] = BLACK;
for (const [r, c] of [[12, 12], [13, 13]]) b[r][c] = WHITE;
b[10][7] = WHITE;              // 白挡在双三点

const history = [];
let turn = BLACK, plies = 1;
while (plies < 40) {
  const mv = A.getBestMove('hard', turn);
  if (!mv || b[mv[0]][mv[1]] !== EMPTY) { console.log('非法落点', mv); break; }
  b[mv[0]][mv[1]] = turn;
  plies++;
  history.push(`${turn === BLACK ? 'B' : 'W'}${mv[0]},${mv[1]}`);
  if (hasFive(mv[0], mv[1], turn)) {
    console.log(`第 ${plies} 手 ${turn === BLACK ? '黑' : '白'}胜，落点 (${mv[0]},${mv[1]})`);
    /* 打印获胜连线 */
    for (const [dr, dc] of A.DIRECTIONS) {
      const line = [];
      for (let i = -4; i <= 4; i++) {
        const rr = mv[0] + dr * i, cc = mv[1] + dc * i;
        if (rr >= 0 && rr < S && cc >= 0 && cc < S && b[rr][cc] === turn) line.push(`(${rr},${cc})`);
      }
      if (line.length >= 5) console.log('  五连:', line.join(' '));
    }
    break;
  }
  turn = turn === BLACK ? WHITE : BLACK;
}

console.log('\n落子序列:', history.join(' '));
console.log('\n最终盘面（. 空 / X 黑 / O 白），只打印 4~16 行 3~17 列:');
console.log('     ' + Array.from({ length: 15 }, (_, i) => String(i + 3).padStart(2)).join(''));
for (let r = 4; r <= 16; r++) {
  let line = String(r).padStart(3) + '  ';
  for (let c = 3; c <= 17; c++) line += (b[r][c] === BLACK ? ' X' : b[r][c] === WHITE ? ' O' : ' .');
  console.log(line);
}

/* 核对：每一步落子后是否形成五连（用独立实现复查） */
function independentHasFive(r, c, color) {
  const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
  for (const [dr, dc] of dirs) {
    let n = 1;
    for (let i = 1; i < 5; i++) { const rr = r + dr * i, cc = c + dc * i; if (rr < 0 || rr >= S || cc < 0 || cc >= S || b[rr][cc] !== color) break; n++; }
    for (let i = 1; i < 5; i++) { const rr = r - dr * i, cc = c - dc * i; if (rr < 0 || rr >= S || cc < 0 || cc >= S || b[rr][cc] !== color) break; n++; }
    if (n >= 5) return true;
  }
  return false;
}
console.log('\n用独立实现复查最终盘面是否真有五连:');
let found = false;
for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) {
  if (b[r][c] !== EMPTY && independentHasFive(r, c, b[r][c])) { console.log(`  (${r},${c}) 颜色 ${b[r][c]} 成五`); found = true; }
}
if (!found) console.log('  ✗ 没有五连 → 说明前面的“黑胜”判定有误！');
