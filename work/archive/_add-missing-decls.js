// 扫描模块中“被函数使用、但整份文件都没有声明”的标识符，并补齐声明。
// 起因：强度改造是半成品——既缺状态声明（spaceSum/evalReady…已补），
//       还漏了 candScratch 之类连模板都没有的变量。用整文件级别的扫描一次找齐。
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const MODULE = path.join(ROOT, 'outputs', 'engine', 'gomoku-ai.js');
const src = fs.readFileSync(MODULE, 'utf8');
const lines = src.split(/\r?\n/);

/* 全文件的顶层声明与函数定义 */
const declared = new Set([...src.matchAll(/^\s*(?:let|const|var|function)\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1]));
const params = new Set();
/* 收集所有函数/箭头函数的参数名（粗粒度但足够用） */
for (const m of src.matchAll(/function\s*[A-Za-z_$\w]*\s*\(([^)]*)\)/g)) {
  for (const p of m[1].split(',')) {
    const n = p.trim().split('=')[0].trim().replace(/^\.\.\./, '');
    if (/^[A-Za-z_$][\w$]*$/.test(n)) params.add(n);
  }
}
for (const m of src.matchAll(/\(([^)]*)\)\s*=>/g)) {
  for (const p of m[1].split(',')) {
    const n = p.trim().split('=')[0].trim();
    if (/^[A-Za-z_$][\w$]*$/.test(n)) params.add(n);
  }
}
const IGNORE = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'typeof', 'new',
  'do', 'else', 'this', 'in', 'of', 'var', 'let', 'const', 'case', 'break', 'continue', 'delete',
  'instanceof', 'void', 'yield', 'await', 'async', 'class', 'extends', 'super', 'try', 'throw',
  'default', 'export', 'import', 'from', 'as', 'null', 'true', 'false', 'undefined', 'NaN', 'Infinity']);

/* 只扫函数体（三、引擎实现 ~ 四、开局库），避免把注释/字符串算进去 */
const iFuncs = lines.findIndex(l => l.startsWith('/* ---------------- 三、引擎实现'));
const iBook = lines.findIndex(l => l.startsWith('/* ---------------- 四、开局库'));
const code = lines.slice(iFuncs, iBook).join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/\/\/[^\n]*/g, ' ')
  .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
  .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
  .replace(/`(?:[^`\\]|\\.)*`/g, '``');

const suspects = new Map();
for (const m of code.matchAll(/(?<![\w.$'"`])([a-z_$][\w$]*)\b/g)) {
  const n = m[1];
  if (IGNORE.has(n) || declared.has(n) || params.has(n)) continue;
  const before = code[m.index - 1];
  if (before === '.') continue;
  const rest = code.slice(m.index + n.length);
  if (/^\s*:/.test(rest)) continue;          // 对象字面量的键
  suspects.set(n, (suspects.get(n) || 0) + 1);
}

/* 用“未声明的标识符”做关键字筛选：只保留看起来像状态变量、且出现次数≥2 的 */
const likely = [...suspects.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]);
console.log('==== 疑似漏声明（出现≥2 次，且整文件无声明） ====');
for (const [n, c] of likely) console.log(`  ${n.padEnd(24)} ${c} 次`);
if (!likely.length) { console.log('  （无）'); process.exit(0); }

/* 逐个尝试“补成全局状态并再跑一次语法/加载检查”，只保留真正的漏声明 */
const CANDIDATE_INIT = {
  candScratch: 'let candScratch = null;      // 候选点临时缓冲（强度改造新增）',
};
const toAdd = likely.filter(([n]) => CANDIDATE_INIT[n]);
if (!toAdd.length) { console.log('\n（没有已知初始化的候选项，需人工确认上面列表）'); process.exit(0); }

const iFuncsMark = lines.findIndex(l => l.startsWith('/* ---------------- 三、引擎实现'));
const inject = toAdd.map(([n]) => CANDIDATE_INIT[n]);
const out = [...lines.slice(0, iFuncsMark), '/* ---- 补漏声明 ---- */', ...inject, '', ...lines.slice(iFuncsMark)].join('\n');

const problems = [];
try { new vm.Script(out, { filename: 'gomoku-ai.js' }); } catch (e) { problems.push('语法错误: ' + e.message); }
if (problems.length) { console.log('!! 失败:'); problems.forEach(p => console.log('  - ' + p)); process.exit(1); }

fs.copyFileSync(MODULE, path.join(ROOT, 'work', 'archive', 'gomoku-ai.js.before-missing-decls'));
fs.writeFileSync(MODULE, out, 'utf8');
console.log(`\n已补入 ${toAdd.length} 条声明: ` + toAdd.map(([n]) => n).join(', '));
