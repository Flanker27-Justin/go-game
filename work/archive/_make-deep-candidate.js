// 重新生成“深度加强”候选：预算 8s、searchDepth 3/5/6 → 5/7/8。
// 修正上次的错误：上次用 `replace('  return 3;                     // 开局/中盘', '  return 5;')`
// 把注释搞断了，产出的文件语法错误、在沙箱里直接抛异常，
// 导致“加深搜索无效”的结论建立在**跑不起来的文件**上（结论作废）。
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'outputs', 'engine', 'gomoku-ai.js');
const OUT = path.join(ROOT, 'work', 'archive', '_engine-deep.js');

let src = fs.readFileSync(SRC, 'utf8');
const misses = [];
const rep = (from, to) => { if (!src.includes(from)) { misses.push(from); return; } src = src.replace(from, to); };

rep('const SEARCH_BUDGET_MS = 2500;', 'const SEARCH_BUDGET_MS = 8000;');
/* 只替换 return 语句本身，保留注释 */
rep('  if (placed >= 60) return 6;', '  if (placed >= 60) return 8;');
rep('  if (placed >= 35) return 5;', '  if (placed >= 35) return 7;');
rep('  return 3;', '  return 5;');            // 该行在 searchDepth 内唯一

const problems = [];
if (misses.length) for (const m of misses) problems.push('未命中: ' + JSON.stringify(m));
try { new vm.Script(src, { filename: 'deep.js' }); }
catch (e) { problems.push('语法错误: ' + e.message); }
/* 额外确认：文件能被真正执行（上次正是在这里失败） */
if (!problems.length) {
  const sb = { module: { exports: {} }, console, performance: { now: () => Date.now() }, Math, JSON, Set, Map, Int32Array, Array, Object, Number, String, isNaN, parseInt, parseFloat, Infinity, NaN };
  sb.globalThis = sb;
  vm.createContext(sb);
  try {
    vm.runInContext(src, sb, { filename: 'deep.js' });
    const A = sb.module.exports;
    A.setBoardSize(19); A.setMoveVariety(0);
    if (typeof A.getBestMove !== 'function') problems.push('加载后 getBestMove 不可用');
  } catch (e) { problems.push('执行失败: ' + e.message); }
}
if (problems.length) { console.log('!! 生成失败:'); for (const p of problems) console.log('  - ' + p); process.exit(1); }

fs.writeFileSync(OUT, src, 'utf8');
console.log('已生成并验证可执行: work/archive/_engine-deep.js');
console.log('  SEARCH_BUDGET_MS = 8000, searchDepth 5/7/8');
