// 插桩统计：一整局里 getBestMove 究竟由哪一层决定落子（阶梯 vs 搜索）。
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');

/* 在 getBestMove 的每个 return 前打点，统计命中分布 */
let src = fs.readFileSync(path.join(ROOT, 'outputs', 'engine', 'gomoku-ai.js'), 'utf8');

/* 给 getBestMove 体内所有 `return X;` / `return X(...)` 打点：
 * 用正则把 `return expr;` 换成 `return __hit('名字', expr);` 不可行（表达式千变万化），
 * 改为在每个候选短路分支的 if 内插入打点。这里用更稳的办法：
 * 在函数开头挂一个 Proxy 计数——直接统计各层函数被“调用”的次数与搜索实际耗时。 */
const anchor = 'function getBestMove(level, forColor) {';
const hitFn = `
  const __t = globalThis.__probe = globalThis.__probe || { calls: 0, layers: {}, deepSearch: 0, fast: 0 };
  __t.calls++;
`;
src = src.replace(anchor, anchor + hitFn);

/* 统计关键层被调用次数（包一层计数，不改逻辑） */
for (const fn of ['findImmediateWin', 'findVcfWin', 'findVctWin', 'findDoubleThreat', 'findDoubleKill', 'bookMove', 'openingMove', 'resolveThreats', 'bestBySearch', 'bestByScore']) {
  const re = new RegExp('^function\\s+' + fn + '\\s*\\(', 'm');
  if (!re.test(src)) { console.log('  （未找到 ' + fn + '，跳过）'); continue; }
  src = src.replace(re, `function ${fn}(`.replace(fn, fn));
  src = src.replace(re, (m) => m);   // 占位
}
/* 上面那样无法统计“调用次数”，改为在 bestBySearch 内打点耗时分档 */
src = src.replace('  if (ordered.length === 0) return null;',
  '  if (ordered.length === 0) return null;\n  if (globalThis.__probe) { globalThis.__probe.searchEntered = (globalThis.__probe.searchEntered || 0) + 1; }');

const sandbox = { module: { exports: {} }, console, performance: { now: () => Date.now() }, Math, JSON, Set, Map, Int32Array, Array, Object, Number, String, isNaN, parseInt, parseFloat, Infinity, NaN };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'engine-probe.js' });
const A = sandbox.module.exports;
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
b[9][9] = BLACK;
sandbox.__probe = { calls: 0, searchEntered: 0 };

const per = [];
let stones = 1, turn = WHITE;
while (stones < 62) {
  const before = sandbox.__probe.searchEntered || 0;
  const t0 = Date.now();
  const mv = A.getBestMove('hard', turn);
  const dt = Date.now() - t0;
  const entered = (sandbox.__probe.searchEntered || 0) > before;
  per.push({ ply: stones + 1, turn, ms: dt, enteredSearch: entered, mv });
  if (!mv || b[mv[0]][mv[1]] !== EMPTY) break;
  b[mv[0]][mv[1]] = turn;
  stones++;
  if (hasFive(mv[0], mv[1], turn)) break;
  turn = turn === BLACK ? WHITE : BLACK;
}

console.log('==== 一整局（hard 档）的决策构成 ====');
console.log(`总着法 ${per.length}，其中进入搜索的 ${per.filter(x => x.enteredSearch).length} 次（${(per.filter(x => x.enteredSearch).length / per.length * 100).toFixed(0)}%）`);
console.log(`未进搜索（阶梯直接决定）${per.filter(x => !x.enteredSearch).length} 次`);
console.log(`耗时分布：<5ms ${per.filter(x => x.ms < 5).length} | 5-100ms ${per.filter(x => x.ms >= 5 && x.ms < 100).length} | >=100ms ${per.filter(x => x.ms >= 100).length}`);
console.log('\n逐手明细（前 40 手）:');
console.log('手 颜色 耗时ms 进搜索 落点');
for (const x of per.slice(0, 40)) {
  console.log(`${String(x.ply).padStart(3)} ${x.turn === BLACK ? '黑' : '白'} ${String(x.ms).padStart(6)} ${x.enteredSearch ? ' 是 ' : ' 否 '} ${x.mv}`);
}
const searched = per.filter(x => x.enteredSearch);
console.log(`\n进搜索的着法平均耗时 ${searched.length ? Math.round(searched.reduce((a, x) => a + x.ms, 0) / searched.length) : 0}ms`);
console.log(`未进搜索的着法平均耗时 ${Math.round(per.filter(x => !x.enteredSearch).reduce((a, x) => a + x.ms, 0) / Math.max(1, per.filter(x => !x.enteredSearch).length))}ms`);
