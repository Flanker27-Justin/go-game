// 评估函数判别力测试：它能否区分“主动展开”与“被动受制”的局面？
// 若能区分，说明问题在决策层（阶梯选点）；若不能，说明评估本身缺“主动权/结构”维度。
'use strict';
const path = require('path');
const A = require(path.join(__dirname, '..', 'outputs', 'engine', 'gomoku-ai.js'));
const BLACK = 1, WHITE = 2, EMPTY = 0;
const S = 19;
A.setMoveVariety(0);
A.setBoardSize(S);

function clear() { const b = A.board; for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) b[r][c] = EMPTY; }
function put(color, cells) { for (const [r, c] of cells) A.board[r][c] = color; }

/** 统计某方“一手能形成活三以上威胁”的点数（= 进攻选择面） */
function attackPoints(color) {
  let n = 0;
  for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) {
    if (A.board[r][c] !== EMPTY) continue;
    if (A.threatLevel(r, c, color) >= 1) n++;
  }
  return n;
}

const scenarios = [
  {
    name: 'A 白主动展开（白有多个活二/交叉结构）',
    setup: () => { clear(); put(BLACK, [[9, 9]]); put(WHITE, [[8, 9], [9, 8]]); },
  },
  {
    name: 'B 白被动受制（白子散落边角、黑压中心）',
    setup: () => { clear(); put(BLACK, [[9, 9], [10, 9], [9, 10]]); put(WHITE, [[1, 1], [17, 17]]); },
  },
  {
    name: 'C 白有活三（明确进攻结构）',
    setup: () => { clear(); put(BLACK, [[2, 2]]); put(WHITE, [[10, 5], [10, 6], [10, 7]]); },
  },
  {
    name: 'D 白无威胁但有中心控制（孤子占中心）',
    setup: () => { clear(); put(BLACK, [[2, 2]]); put(WHITE, [[9, 9]]); },
  },
];

console.log('==== 评估函数判别力 ====');
console.log('场景                                    白视角评估  白进攻点  黑进攻点');
for (const sc of scenarios) {
  sc.setup();
  const ev = A.evaluateBoard(WHITE, BLACK, 1, WHITE);   // 白视角、白先手
  const wa = attackPoints(WHITE);
  const ba = attackPoints(BLACK);
  console.log(`${sc.name.padEnd(38)} ${String(Math.round(ev)).padStart(10)} ${String(wa).padStart(8)} ${String(ba).padStart(8)}`);
}

console.log('\n判读：若“白主动展开”的评估分明显高于“白被动受制 / 白无威胁”，');
console.log('      说明评估能分辨主动与被动，棋力瓶颈在决策层；否则评估缺少该维度。');

/* 补充：在同一个真实对局局面下，评估对“白方各候选点”的排序是否合理 */
clear();
put(BLACK, [[9, 9], [10, 9], [8, 9]]);     // 黑竖活三（白必须处理）
put(WHITE, [[9, 8], [9, 10]]);             // 白已挡两侧？不，白是(9,8)(9,10)黑在(9,9)被夹
console.log('\n真实局面：黑 (9,9)(10,9)(8,9) 竖活三；白 (9,8)(9,10)');
console.log('  白方各候选点的“落子后白视角评估”:');
const cands = [];
for (let r = 7; r <= 11; r++) {
  for (let c = 7; c <= 11; c++) {
    if (A.board[r][c] !== EMPTY) continue;
    A.board[r][c] = WHITE;
    const ev = A.evaluateBoard(WHITE, BLACK, 1, BLACK);
    A.board[r][c] = EMPTY;
    cands.push({ mv: [r, c], ev });
  }
}
cands.sort((a, b) => b.ev - a.ev);
for (const x of cands.slice(0, 8)) console.log(`    (${x.mv}) → ${Math.round(x.ev)}`);
