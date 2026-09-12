// 定位实验：前 31 手（决定性阶段）里，双方的着法性质分布——
// 有多少手是“被迫防守”、多少手是“主动建立威胁”。
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

/** 判断“若轮到 color，他是否能一步成五” */
function canWinNow(color) { return !!A.findImmediateWin(color); }

const b = A.board;
for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) b[r][c] = EMPTY;
b[9][9] = BLACK;
let stones = 1, turn = WHITE;
const rows = [];
while (stones < 62) {
  const me = turn, opp = me === BLACK ? WHITE : BLACK;
  const oppThreat = canWinNow(opp);        // 对方有一步成五 → 我必须防守
  const myThreat = canWinNow(me);          // 我有一手成五 → 我可以直接赢
  const t0 = Date.now();
  const mv = A.getBestMove('hard', me);
  const dt = Date.now() - t0;
  if (!mv || b[mv[0]][mv[1]] !== EMPTY) break;
  const lv = A.threatLevel(mv[0], mv[1], me);   // 这一手自己形成的威胁等级
  const lvOpp = A.threatLevel(mv[0], mv[1], opp); // 这一手封堵了对方什么
  b[mv[0]][mv[1]] = me;
  rows.push({ ply: stones + 1, color: me === BLACK ? '黑' : '白', mv: mv.join(','), ms: dt, lv, lvOpp, forced: oppThreat, couldWin: myThreat });
  stones++;
  if (hasFive(mv[0], mv[1], me)) break;
  turn = opp;
}

console.log('==== 前 31 手的着法性质 ====');
console.log('手 颜色 落点     自己威胁等级 封堵对方 被迫防守 本可成五');
for (const x of rows) {
  console.log(`${String(x.ply).padStart(3)} ${x.color} ${x.mv.padEnd(8)} ${String(x.lv).padStart(8)} ${String(x.lvOpp).padStart(8)} ${x.forced ? '  是' : '  否'} ${x.couldWin ? '  是' : '  否'}`);
}
const blk = rows.filter(x => x.color === '黑');
const wth = rows.filter(x => x.color === '白');
const stat = (arr, label) => {
  const forced = arr.filter(x => x.forced).length;
  const attack = arr.filter(x => !x.forced && x.lv >= 1).length;   // 非被迫且自己成活三以上
  const passive = arr.filter(x => !x.forced && x.lv === 0).length;
  console.log(`${label}: 共 ${arr.length} 手 | 被迫防守 ${forced} | 主动进攻(活三+) ${attack} | 平淡发展 ${passive}`);
};
console.log('');
stat(blk, '黑方');
stat(wth, '白方');

/* 关键指标：白方有多少手在“自己没威胁、也没被迫”时选择了平淡发展 */
console.log('\n白方平淡发展手（既无自身威胁、也非被迫）:');
for (const x of wth.filter(x => !x.forced && x.lv === 0)) console.log(`  第${x.ply}手 ${x.mv}`);
