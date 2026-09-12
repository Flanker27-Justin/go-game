// 从模板的“五、对外接口”段生成模块接口代码，并用它替换模块里那段裸函数接口。
// 起因：强度改造把模板接口改成了 publicFn(...) 包装（页面/测试会直接改写 AI.board，
//       必须靠这层包装同步增量棋型状态），但模块里仍是上一轮的裸函数接口 →
//       外部调用读到过期缓存，所有局面都返回同一个点。
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const MODULE = path.join(ROOT, 'outputs', 'engine', 'gomoku-ai.js');
const BACKUP = path.join(ROOT, 'work', 'archive', 'gomoku-ai.js.before-api-sync');
const template = fs.readFileSync(path.join(ROOT, 'work', '_engine-template.js'), 'utf8');

/* ---------- 1. 从模板取出接口段（return { ... };） ---------- */
const tLines = template.split(/\r?\n/);
const iApi = tLines.findIndex(l => l.includes('五、对外接口'));
if (iApi < 0) throw new Error('模板里找不到“五、对外接口”标记');
const iReturn = tLines.findIndex((l, i) => i > iApi && /^\s*return\s*\{/.test(l));
if (iReturn < 0) throw new Error('模板接口段里找不到 return {');
/* 找到与之配对的 `};` */
let depth = 0, iEnd = -1;
for (let i = iReturn; i < tLines.length; i++) {
  for (const ch of tLines[i]) {
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { iEnd = i; break; } }
  }
  if (iEnd >= 0) break;
}
if (iEnd < 0) throw new Error('模板接口段的 return { 未闭合');
const apiCode = tLines.slice(iReturn, iEnd + 1).join('\n');
if (!/publicFn\(/.test(apiCode)) throw new Error('模板接口段里没有 publicFn 包装，可能不是这份改造');
console.log(`模板接口段: L${iReturn + 1}~L${iEnd + 1}（${iEnd - iReturn + 1} 行）`);

/* ---------- 2. 替换模块里的接口段 ---------- */
const mod = fs.readFileSync(MODULE, 'utf8');
const mLines = mod.split(/\r?\n/);
const mApi = mLines.findIndex(l => l.includes('五、对外接口'));
if (mApi < 0) throw new Error('模块里找不到“五、对外接口”标记');
const mReturn = mLines.findIndex((l, i) => i > mApi && /^\s*return\s*\{/.test(l));
if (mReturn < 0) throw new Error('模块接口段里找不到 return {');
let md = 0, mEnd = -1;
for (let i = mReturn; i < mLines.length; i++) {
  for (const ch of mLines[i]) {
    if (ch === '{') md++;
    else if (ch === '}') { md--; if (md === 0) { mEnd = i; break; } }
  }
  if (mEnd >= 0) break;
}
if (mEnd < 0) throw new Error('模块接口段的 return { 未闭合');
console.log(`模块接口段: L${mReturn + 1}~L${mEnd + 1}`);

const out = [...mLines.slice(0, mReturn), ...apiCode.split('\n'), ...mLines.slice(mEnd + 1)].join('\n');

/* ---------- 3. 自检：语法 + 关键包装是否存在 ---------- */
const problems = [];
try { new vm.Script(out, { filename: 'gomoku-ai.js' }); }
catch (e) { problems.push('语法错误: ' + e.message); }
for (const k of ['getBestMove: publicFn(', 'evaluateCell: publicFn(', 'threatLevel: publicFn(']) {
  if (!out.includes(k)) problems.push('缺少包装: ' + k);
}
if (problems.length) { console.log('!! 失败:'); problems.forEach(p => console.log('  - ' + p)); process.exit(1); }

fs.copyFileSync(MODULE, BACKUP);
fs.writeFileSync(MODULE, out, 'utf8');
console.log('\n已同步接口段到模块（含 publicFn 包装）');
console.log('备份: work/archive/gomoku-ai.js.before-api-sync');
