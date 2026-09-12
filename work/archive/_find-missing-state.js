// 找出引擎模块中“被函数使用、但没有顶层声明”的状态变量。
// 用于修复“强度改造”留下的半成品：函数引用了新状态，但声明只在模板里、没进模块。
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const MODULE = path.join(ROOT, 'outputs', 'engine', 'gomoku-ai.js');
const TEMPLATE = path.join(ROOT, 'work', '_engine-template.js');

const src = fs.readFileSync(MODULE, 'utf8');
const lines = src.split(/\r?\n/);

const iState = lines.findIndex(l => l.startsWith('/* ---------------- 二、引擎状态'));
const iFuncs = lines.findIndex(l => l.startsWith('/* ---------------- 三、引擎实现'));
const iBook = lines.findIndex(l => l.startsWith('/* ---------------- 四、开局库'));
if (iState < 0 || iFuncs < 0 || iBook < 0) { console.error('找不到段落标记'); process.exit(2); }

const stateText = lines.slice(iState, iFuncs).join('\n');
const funcsText = lines.slice(iFuncs, iBook).join('\n');

/* 模块状态段里已声明的名字 */
const declared = new Set([...stateText.matchAll(/^\s*(?:let|const|var)\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1]));
/* 模块里定义的函数名 */
const fnNames = new Set([...src.matchAll(/^\s*function\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1]));
/* 常量名 */
const constNames = new Set([...src.matchAll(/^\s*const\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1]));
/* 模块里 import/内建/参数等可忽略名单 */
const IGNORE = new Set(['EMPTY', 'BLACK', 'WHITE', 'DIRECTIONS', 'Math', 'JSON', 'Set', 'Map', 'Int32Array',
  'Array', 'Object', 'Number', 'String', 'Boolean', 'Infinity', 'NaN', 'isNaN', 'parseInt', 'parseFloat',
  'performance', 'console', 'module', 'root', 'factory', 'if', 'for', 'while', 'switch', 'catch',
  'return', 'function', 'typeof', 'new', 'do', 'else', 'this', 'undefined', 'null', 'true', 'false']);

/* 扫函数体里用到的“裸标识符”，找出既不是声明、也不是函数、也不是常量的 */
const codeText = funcsText
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/\/\/[^\n]*/g, ' ')
  .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
  .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
  .replace(/`(?:[^`\\]|\\.)*`/g, '``');

const used = new Map();
for (const m of codeText.matchAll(/(?<![\w.$'"`])([a-z_$][\w$]*)\b/g)) {
  const n = m[1];
  if (IGNORE.has(n) || declared.has(n) || fnNames.has(n) || constNames.has(n)) continue;
  /* 排除明显是属性名/标签的情形：形如 xxx.name 或 name: */
  const at = m.index;
  const before = codeText[at - 1];
  const after = codeText.slice(at + n.length).match(/^\s*[:]/);
  if (before === '.' || after) continue;
  used.set(n, (used.get(n) || 0) + 1);
}

/* 与模板的状态段对照：模板里声明过、但模块里没有的，就是“缺声明” */
const tmpl = fs.readFileSync(TEMPLATE, 'utf8');
const tmplDeclared = new Set([...tmpl.matchAll(/^\s*(?:let|const|var)\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1]));

const missing = [...used.entries()].filter(([n]) => tmplDeclared.has(n)).sort((a, b) => b[1] - a[1]);
console.log('==== 模块中“被使用但未声明”的变量（且模板里有声明 → 属于漏搬） ====');
if (!missing.length) console.log('  （无）');
for (const [n, c] of missing) console.log(`  ${n.padEnd(22)} 使用 ${c} 次`);

const otherMissing = [...used.entries()].filter(([n]) => !tmplDeclared.has(n) && !/^[A-Z]/.test(n)).sort((a, b) => b[1] - a[1]);
console.log('\n==== 其它可疑的未声明标识符（模板里也没有，需人工确认） ====');
if (!otherMissing.length) console.log('  （无）');
for (const [n, c] of otherMissing.slice(0, 40)) console.log(`  ${n.padEnd(22)} 使用 ${c} 次`);

/* 输出可直接粘贴的状态声明建议（取模板里的原文行） */
console.log('\n==== 建议补进模块的声明原文（取自模板） ====');
const tmplLines = tmpl.split(/\r?\n/);
for (const [n] of missing) {
  const line = tmplLines.find(l => new RegExp('^\\s*(?:let|const|var)\\s+' + n + '\\b').test(l));
  if (line) console.log('  ' + line.trim());
}
