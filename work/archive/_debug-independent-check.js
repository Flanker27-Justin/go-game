// 独立复核：白 (11,11) → 黑 (9,9) → 白 (14,14) 这三手是否真构成白方五连？
'use strict';
const path = require('path');
const A = require(path.join(__dirname, '..', 'outputs', 'engine', 'gomoku-ai.js'));
const BLACK = 1, WHITE = 2, EMPTY = 0;
const S = 19;
A.setBoardSize(S);
const b = A.board;
for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) b[r][c] = EMPTY;
for (const [r, c] of [[10, 5], [10, 6], [8, 7], [9, 7]]) b[r][c] = BLACK;
for (const [r, c] of [[12, 12], [13, 13], [10, 10]]) b[r][c] = WHITE;
b[11][11] = WHITE;   // 白
b[9][9] = BLACK;     // 黑
b[14][14] = WHITE;   // 白

console.log('盘面（相关人员）:');
console.log('  白: (10,10) (11,11) (12,12) (13,13) (14,14)');
console.log('  黑: (10,5) (10,6) (8,7) (9,7) (9,9)');

/* 独立实现：找所有五连 */
function fiveLines(color) {
  const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
  const out = [];
  for (let r = 0; r < S; r++) {
    for (let c = 0; c < S; c++) {
      if (b[r][c] !== color) continue;
      for (const [dr, dc] of dirs) {
        // 只从线段起点开始
        const pr = r - dr, pc = c - dc;
        if (pr >= 0 && pr < S && pc >= 0 && pc < S && b[pr][pc] === color) continue;
        let n = 0;
        while (true) {
          const rr = r + dr * n, cc = c + dc * n;
          if (rr < 0 || rr >= S || cc < 0 || cc >= S || b[rr][cc] !== color) break;
          n++;
        }
        if (n >= 5) {
          const cells = [];
          for (let i = 0; i < n; i++) cells.push([r + dr * i, c + dc * i]);
          out.push({ start: [r, c], dir: [dr, dc], len: n, cells });
        }
      }
    }
  }
  return out;
}
const whiteFives = fiveLines(WHITE);
const blackFives = fiveLines(BLACK);
console.log('\n白方五连:', whiteFives.length ? JSON.stringify(whiteFives) : '无');
console.log('黑方五连:', blackFives.length ? JSON.stringify(blackFives) : '无');

/* 关键：白 (11,11)(12,12)(13,13)(14,14) 是四连，(10,10) 补上就是五连 —— 但 (10,10) 已被白占！ */
const diag = [[10, 10], [11, 11], [12, 12], [13, 13], [14, 14]];
console.log('\n主对角线 (10,10)~(14,14) 上各点归属:');
for (const [r, c] of diag) console.log(`  (${r},${c}) = ${b[r][c] === WHITE ? '白' : b[r][c] === BLACK ? '黑' : '空'}`);
console.log('→ 这五点在白 (14,14) 落下后全部为白：', diag.every(([r, c]) => b[r][c] === WHITE));
console.log('\n结论：白方确实在 (10,10)-(14,14) 主对角线形成五连。');
console.log('          即初始局面里白已有 (10,10)(12,12)(13,13)，白 (11,11) 补中间、(14,14) 补末端 → 五连。');
console.log('          这解释了两件事：');
console.log('           ① 白 (11,11) 是必胜手（黑无法在两手内既堵 (9,9)/(14,14) 又活自己的棋）；');
console.log('           ② 我把 (11,11) 列为“错误应手”是错的，该题面本身设计失败。');
