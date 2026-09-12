// 实证判断：两种白方应手之后，让双方都用本引擎继续走，看谁输谁赢。
'use strict';
const path = require('path');
const A = require(path.join(__dirname, '..', 'outputs', 'engine', 'gomoku-ai.js'));
const BLACK = 1, WHITE = 2, EMPTY = 0;
const S = 19;
A.setMoveVariety(0);
A.setBoardSize(S);
A.setColors(WHITE, BLACK);   // aiColor=白（先把颜色设好，逐手用参数指定行动方）

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

function playOut(whiteFirst) {
  const b = A.board;
  for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) b[r][c] = EMPTY;
  for (const [r, c] of [[10, 5], [10, 6], [8, 7], [9, 7]]) b[r][c] = BLACK;
  for (const [r, c] of [[12, 12], [13, 13], [10, 10]]) b[r][c] = WHITE;   // 白多一个 (10,10)
  /* 白方按指定应手先走 */
  b[whiteFirst[0]][whiteFirst[1]] = WHITE;
  if (hasFive(whiteFirst[0], whiteFirst[1], WHITE)) return { winner: '白', plies: 1 };
  let turn = BLACK, plies = 1;
  const moves = [`W(${whiteFirst})`];
  while (plies < 60) {
    const mv = A.getBestMove('hard', turn);
    if (!mv || b[mv[0]][mv[1]] !== EMPTY) return { winner: '异常', plies, moves };
    b[mv[0]][mv[1]] = turn;
    plies++;
    moves.push(`${turn === BLACK ? 'B' : 'W'}(${mv})`);
    if (hasFive(mv[0], mv[1], turn)) return { winner: turn === BLACK ? '黑' : '白', plies, moves };
    turn = turn === BLACK ? WHITE : BLACK;
  }
  return { winner: '和/超限', plies, moves };
}

for (const cand of [[10, 7], [11, 11], [14, 14]]) {
  const res = playOut(cand);
  console.log(`白方应手 ${JSON.stringify(cand)} → ${res.winner} 胜，共 ${res.plies} 手`);
  console.log('   对局: ' + res.moves.slice(0, 18).join(' '));
}

/* 补充：直接看静态评估（黑视角），白挡在 (10,7) 与走 (11,11) 的差别 */
function staticEval(whiteMove) {
  const b = A.board;
  for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) b[r][c] = EMPTY;
  for (const [r, c] of [[10, 5], [10, 6], [8, 7], [9, 7]]) b[r][c] = BLACK;
  for (const [r, c] of [[12, 12], [13, 13], [10, 10]]) b[r][c] = WHITE;
  b[whiteMove[0]][whiteMove[1]] = WHITE;
  return A.evaluateBoard(WHITE, BLACK, 1, null);   // 白视角，越高越利于白
}
console.log('\n静态评估（白视角，越高越利于白）:');
for (const cand of [[10, 7], [11, 11], [14, 14]]) {
  console.log(`  白走 ${JSON.stringify(cand)} → ${staticEval(cand)}`);
}
