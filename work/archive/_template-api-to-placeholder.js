// 一次性：把模板里硬编码的接口段（return { … };）替换成 @@API@@ 占位符，
// 使 build-engine.js 能生成带 publicFn 包装的接口（否则模块接口会被写坏）。
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const T = path.join(ROOT, 'work', '_engine-template.js');
const lines = fs.readFileSync(T, 'utf8').split(/\r?\n/);

const iPh = lines.findIndex(l => l.trim() === '@@API@@');
if (iPh < 0) { console.error('找不到 @@API@@ 占位符'); process.exit(2); }
const iRet = lines.findIndex((l, i) => i > iPh && /^\s*return\s*\{/.test(l));
if (iRet < 0) { console.error('找不到硬编码的 return {'); process.exit(2); }

/* 找到与 return { 配对的 }; */
let depth = 0, end = -1;
for (let i = iRet; i < lines.length; i++) {
  for (const ch of lines[i]) {
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end >= 0) break;
}
if (end < 0) { console.error('return { 未闭合'); process.exit(2); }
console.log(`将删除模板中硬编码的接口段：L${iRet + 1}~L${end + 1}（${end - iRet + 1} 行），保留 @@API@@`);

const out = [...lines.slice(0, iRet), ...lines.slice(end + 1)];
fs.copyFileSync(T, path.join(ROOT, 'work', 'archive', '_engine-template.js.before-api-placeholder'));
fs.writeFileSync(T, out.join('\n'), 'utf8');

/* 自检：占位符仍在、且不再有硬编码 return { */
const now = fs.readFileSync(T, 'utf8');
const problems = [];
if (!/^@@API@@$/m.test(now)) problems.push('@@API@@ 丢失');
if (/^\s*return\s*\{/m.test(now)) problems.push('仍残留硬编码的 return {');
for (const need of ['resetState', 'evalStats', 'publicFn']) {
  if (!now.includes(need)) problems.push('丢失了 ' + need);
}
if (problems.length) { console.log('!! 失败:'); problems.forEach(p => console.log('  - ' + p)); process.exit(1); }
console.log('模板已改为占位符形式（resetState/evalStats/publicFn 仍在）');
