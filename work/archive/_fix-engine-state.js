// 一次性修复：把模板里的完整状态段并入引擎模块，使模块自洽可运行。
// 背景：模块里的“强度改造”新代码引用了新增状态变量（spaceSum / evalReady / cgFive …），
//       但这些声明只写在模板里；生成器此前不搬运状态段，模块因此缺少声明，
//       运行时报 xxx is not defined（实测 spaceSum / evalReady）。
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MODULE = path.join(ROOT, 'outputs', 'engine', 'gomoku-ai.js');
const TEMPLATE = path.join(ROOT, 'work', '_engine-template.js');
const BACKUP = path.join(ROOT, 'work', 'archive', 'gomoku-ai.js.before-state-merge');

let mod = fs.readFileSync(MODULE, 'utf8');
const tmpl = fs.readFileSync(TEMPLATE, 'utf8');

/* ---------- 1. 从模板取出“@@STATE@@ 之后”的补充声明 ----------
 * 模板结构：二、引擎状态标记 → 说明注释 → @@STATE@@ → 其余状态声明
 * 其中 @@STATE@@ 由生成器从模块抽取回填，因此模块里必须保留这个占位符，
 * 否则生成器下次运行会把整段状态再插一遍（重复声明）。 */
const tLines = tmpl.split(/\r?\n/);
const tStateMark = tLines.findIndex(l => l.startsWith('/* ---------------- 二、引擎状态'));
const tFuncsMark = tLines.findIndex(l => l.startsWith('/* ---------------- 三、引擎实现'));
const tPlaceholder = tLines.findIndex((l, i) => i > tStateMark && l.trim() === '@@STATE@@');
if (tStateMark < 0 || tFuncsMark < 0 || tPlaceholder < 0) throw new Error('模板中找不到状态段标记或 @@STATE@@');
const tExtra = tLines.slice(tPlaceholder + 1, tFuncsMark).join('\n').trim();   // 占位符之后的补充声明
if (!/let\s+evalReady\b/.test(tExtra) || !/let\s+spaceSum\b/.test(tExtra)) {
  throw new Error('模板 @@STATE@@ 之后缺少 evalReady / spaceSum，模板可能不完整');
}
const tDeclared = new Set([...tExtra.matchAll(/^\s*(?:let|const|var)\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1]));

/* ---------- 2. 模块状态段现状 ---------- */
const mLines = mod.split(/\r?\n/);
const mStateMark = mLines.findIndex(l => l.startsWith('/* ---------------- 二、引擎状态'));
const mFuncsMark = mLines.findIndex(l => l.startsWith('/* ---------------- 三、引擎实现'));
if (mStateMark < 0 || mFuncsMark < 0) throw new Error('模块中找不到状态段标记');
const mStateBody = mLines.slice(mStateMark + 1, mFuncsMark).join('\n');
const mDeclared = new Set([...mStateBody.matchAll(/^\s*(?:let|const|var)\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1]));

const toAdd = [...tDeclared].filter(n => !mDeclared.has(n));
console.log('模板补充声明数:', tDeclared.size, ' 模块状态声明数:', mDeclared.size);
console.log('需要补进模块的声明:', toAdd.length ? toAdd.join(', ') : '(无)');

if (!toAdd.length) {
  console.log('模块已自洽，无需改动。');
  process.exit(0);
}

/* ---------- 3. 把补充声明插到模块状态段的末尾（三、引擎实现 之前） ---------- */
const newLines = [
  ...mLines.slice(0, mFuncsMark),
  '/* ---- 以下为强度改造新增的状态：搜索运行时 / 64 位哈希 / 置换表代龄 / 增量棋型评估 ---- */',
  '',
  tExtra,
  '',
  ...mLines.slice(mFuncsMark),
];
mod = newLines.join('\n');

/* ---------- 4. 自检：模块里所有顶层声明都必须存在 ---------- */
const problems = [];
try { new (require('vm').Script)(mod, { filename: 'gomoku-ai.js' }); }
catch (e) { problems.push('语法错误: ' + e.message); }
/* 关键变量必须都有声明 */
for (const n of ['boardSize', 'board', 'evalReady', 'cgFive', 'cgLv', 'spaceSum', 'movePool', 'ttGen', 'boardHashLo']) {
  if (!new RegExp('^\\s*(?:let|const|var)\\s+' + n + '\\b', 'm').test(mod)) problems.push('缺少声明: ' + n);
}
if (problems.length) { console.log('!! 修复失败:'); problems.forEach(p => console.log('  - ' + p)); process.exit(1); }

fs.copyFileSync(MODULE, BACKUP);
fs.writeFileSync(MODULE, mod, 'utf8');
console.log('\n已修复并写出 outputs/engine/gomoku-ai.js');
console.log('备份: work/archive/gomoku-ai.js.before-state-merge');
