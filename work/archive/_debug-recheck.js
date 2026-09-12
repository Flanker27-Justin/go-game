// 复核：白走 (11,11) 后，黑的最佳应手是什么？白真的赢吗？（双方都用引擎）
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
function setup() {
  const b = A.board;
  for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) b[r][c] = EMPTY;
  for (const [r, c] of [[10, 5], [10, 6], [8, 7], [9, 7]]) b[r][c] = BLACK;
  for (const [r, c] of [[12, 12], [13, 13], [10, 10]]) b[r][c] = WHITE;
}

/* 列出黑方所有合法应手，逐个用静态评估 + 后续搜索判断哪个最好 */
setup();
A.board[11][11] = WHITE;          // 白先走 (11,11)
console.log('白走 (11,11) 后，轮到黑。黑方候选（白视角静态评估，越低越利于黑）:');
const cands = [];
for (let r = 7; r <= 15; r++) {
  for (let c = 4; c <= 15; c++) {
    if (A.board[r][c] !== EMPTY) continue;
    A.board[r][c] = BLACK;
    const ev = A.evaluateBoard(WHITE, BLACK, 1, null);
    A.board[r][c] = EMPTY;
    cands.push({ move: [r, c], ev });
  }
}
cands.sort((a, b) => a.ev - b.ev);
console.log('  黑方最好的 6 个（白视角分最低）:');
for (const x of cands.slice(0, 6)) console.log(`    (${x.move}) ev=${x.ev}`);

/* 让双方都用 hard 引擎走完整盘，看结果 */
console.log('\n双方均用 hard 引擎对走（白先 (11,11)）:');
for (const blackReply of [cands[0].move, [10, 7], [9, 6]]) {
  setup();
  const b = A.board;
  b[11][11] = WHITE;
  let turn = BLACK, plies = 1;
  const moves = ['W(11,11)'];
  let result = null;
  /* 第一步黑按指定应手 */
  b[blackReply[0]][blackReply[1]] = BLACK;
  plies++;
  moves.push(`B(${blackReply})`);
  if (hasFive(blackReply[0], blackReply[1], BLACK)) result = '黑胜';
  turn = WHITE;
  while (!result && plies < 60) {
    const mv = A.getBestMove('hard', turn);
    if (!mv || b[mv[0]][mv[1]] !== EMPTY) { result = '异常'; break; }
    b[mv[0]][mv[1]] = turn;
    plies++;
    moves.push(`${turn === BLACK ? 'B' : 'W'}(${mv})`);
    if (hasFive(mv[0], mv[1], turn)) result = turn === BLACK ? '黑胜' : '白胜';
    turn = turn === BLACK ? WHITE : BLACK;
  }
  console.log(`  黑应 ${JSON.stringify(blackReply)} → ${result || '超限和棋'}，共 ${plies} 手`);
  console.log('     ' + moves.slice(0, 16).join(' '));
}
