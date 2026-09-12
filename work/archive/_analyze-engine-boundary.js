// 依赖分析：精确算出“AI 引擎”包含哪些顶层函数、引用了哪些跨边界符号。
// 用法: node work/_analyze-engine-boundary.js
'use strict';
const fs = require('fs');
const src = fs.readFileSync('outputs/gomoku.html', 'utf8');
const lines = src.split(/\r?\n/);

/* ---------- 1. 收集顶层 function 声明 + 顶层 const/let 声明 ---------- */
function topLevelDecls() {
  const fns = [];      // { name, start, end, line }
  const vars = [];     // { name, line }
  let depth = 0;
  let pendingFn = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (depth === 0) {
      let m = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/.exec(trimmed);
      if (m) pendingFn = { name: m[1], start: i + 1 };
      else {
        m = /^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/.exec(trimmed);
        if (m) vars.push({ name: m[1], line: i + 1 });
      }
    }
    // 统计括号/花括号深度变化（字符串内的括号会干扰，但本文件风格规整，足够用）
    for (const ch of line) {
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0 && pendingFn) { pendingFn.end = i + 1; fns.push(pendingFn); pendingFn = null; }
      }
    }
    if (depth < 0) depth = 0;
  }
  return { fns, vars };
}

/* ---------- 2. 找出每个函数体引用了哪些标识符 ---------- */
function bodyOf(fn) { return lines.slice(fn.start - 1, fn.end).join('\n'); }

function identifiersUsed(text) {
  const ids = new Set();
  // 去掉字符串字面量与注释，减少误报
  const clean = text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
  const re = /[A-Za-z_$][\w$]*/g;
  let m;
  while ((m = re.exec(clean))) ids.add(m[0]);
  return ids;
}

const { fns, vars } = topLevelDecls();
const byName = new Map(fns.map(f => [f.name, f]));
const topVarNames = new Set(vars.map(v => v.name));

/* ---------- 3. 人工指定：AI 引擎的根函数集合（要抽出去的东西） ---------- */
const ENGINE_ROOTS = [
  'getBestMove', 'bestByScore', 'bestBySearch', 'minimax',
  'evaluateBoard', 'evaluateCell', 'lineInfo', 'lineScore', 'directionScore',
  'threatLevel', 'countThreats', 'canWinNow', 'findImmediateWin',
  'resolveThreats', 'scoreFor', 'getCandidateMoves', 'forcingMovesOf',
  'findVcfWin', 'vcfSearch', 'vcfForcingMoves', 'vcfBlockPoints',
  'findVctWin', 'vctSearch', 'vctForcingMoves', 'vctBlockPoints', 'vctDefense',
  'findDoubleThreat', 'findDoubleKill', 'findOpponentDoubleThreat',
  'openingMove', 'bookMove', 'searchDepth',
  'pickVaried', 'pickTopN', 'threatSpaceBonus', 'comboBonus',
  'initSearchTables', 'hashXor', 'ttStore',
];

/* ---------- 4. 求传递闭包：AI 引擎实际需要哪些函数与哪些外部符号 ---------- */
const AI_KEYWORDS = new Set([
  'if', 'else', 'for', 'while', 'return', 'function', 'const', 'let', 'var', 'new', 'typeof',
  'true', 'false', 'null', 'undefined', 'this', 'in', 'of', 'do', 'break', 'continue', 'try',
  'catch', 'finally', 'throw', 'switch', 'case', 'default', 'delete', 'instanceof', 'void',
  'class', 'extends', 'super', 'yield', 'async', 'await', 'Math', 'JSON', 'Array', 'Object',
  'Number', 'String', 'Boolean', 'Set', 'Map', 'Int32Array', 'Float64Array', 'Infinity', 'NaN',
  'isNaN', 'parseInt', 'parseFloat', 'performance', 'Date', 'console', 'globalThis', 'window',
]);

const needed = new Set();
const queue = [...ENGINE_ROOTS.filter(n => byName.has(n))];
const missingRoots = ENGINE_ROOTS.filter(n => !byName.has(n));
while (queue.length) {
  const name = queue.pop();
  if (needed.has(name)) continue;
  needed.add(name);
  for (const id of identifiersUsed(bodyOf(byName.get(name)))) {
    if (byName.has(id) && !needed.has(id)) queue.push(id);
  }
}

/* 引擎闭包内的全部标识符使用情况 */
const usedIds = new Set();
for (const name of needed) for (const id of identifiersUsed(bodyOf(byName.get(name)))) usedIds.add(id);

/* 引擎引用的“外部符号” = 用到了、但既不是闭包内函数、也不是 JS 内置关键字 */
const externalFns = [...usedIds].filter(id => byName.has(id) && !needed.has(id)).sort();
const externalVars = [...usedIds].filter(id => topVarNames.has(id)).sort();
const unknown = [...usedIds].filter(id =>
  !byName.has(id) && !topVarNames.has(id) && !AI_KEYWORDS.has(id) &&
  !/^[A-Z][A-Z0-9_]*$/.test(id)   // 全大写常量另行统计
).sort();
const externalConsts = [...usedIds].filter(id => /^[A-Z][A-Z0-9_]*$/.test(id) && !byName.has(id)).sort();

/* object 属性名误报（如 lineInfo 里的 count/open）不算；这里只报告可疑项供人工确认 */
console.log('================ A. AI 引擎闭包 ================');
console.log(`根函数 ${ENGINE_ROOTS.length} 个，缺失 ${missingRoots.length} 个 ${missingRoots.length ? JSON.stringify(missingRoots) : ''}`);
console.log(`闭包共含 ${needed.size} 个函数`);
const lineRange = [...needed].map(n => byName.get(n)).sort((a, b) => a.start - b.start);
console.log(`源码行范围: ${lineRange[0].start} ~ ${lineRange[lineRange.length - 1].end}`);
// 找出闭包函数之间的“空洞”（不属于引擎、但夹在引擎函数之间的函数）
const gaps = [];
for (let i = 1; i < lineRange.length; i++) {
  const prev = lineRange[i - 1], cur = lineRange[i];
  const between = fns.filter(f => f.start > prev.end && f.end < cur.start);
  if (between.length) gaps.push({ from: prev.name, to: cur.name, fns: between.map(f => `${f.name}(L${f.start})`) });
}
console.log('\n---- 闭包函数之间夹着的“非引擎函数”（抽取时必须排除/单独处理）----');
if (!gaps.length) console.log('(无)');
for (const g of gaps) console.log(`  ${g.from} → ${g.to}: ${g.fns.join(', ')}`);

console.log('\n================ B. 引擎依赖的外部符号 ================');
console.log('外部函数（引擎调用它们，但它们不属于引擎）:');
console.log(externalFns.length ? '  ' + externalFns.join(', ') : '  (无)');
console.log('外部全局变量:');
console.log(externalVars.length ? '  ' + externalVars.join(', ') : '  (无)');
console.log('外部常量（全大写）:');
console.log(externalConsts.length ? '  ' + externalConsts.join(', ') : '  (无)');
console.log('可疑未识别标识符（需人工核对，多为对象属性名误报）:');
console.log(unknown.length ? '  ' + unknown.join(', ') : '  (无)');

console.log('\n================ C. 游戏侧调用引擎的入口 ================');
const gameCalls = [];
for (const f of fns) {
  if (needed.has(f.name)) continue;
  const ids = identifiersUsed(bodyOf(f));
  const hits = [...ids].filter(id => needed.has(id)).sort();
  if (hits.length) gameCalls.push({ fn: f.name, line: f.start, hits });
}
for (const g of gameCalls) console.log(`  ${g.fn} (L${g.line}) → ${g.hits.join(', ')}`);

console.log('\n================ D. 常量定义块 ================');
const constLines = vars.filter(v => /^[A-Z][A-Z0-9_]*$/.test(v.name));
for (const c of constLines) console.log(`  L${c.line}  ${c.name}`);
