// 诊断生成器 dry-run 的报错：语法错误位置 + 三个自检问题的成因
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

/* 直接复用生成器的中间结果：这里手工复现它的拼接过程太绕，
 * 改为先看“模板单独替换占位符后”是否语法正确，定位问题在模板还是拼接。 */
const template = fs.readFileSync(path.join(ROOT, 'work', '_engine-template.js'), 'utf8');

/* 1) 模板里是否残留硬编码 @@ 之外的可疑内容 */
console.log('--- 模板中所有 @@ 出现位置 ---');
template.split('\n').forEach((l, i) => { if (l.includes('@@')) console.log(`  L${i + 1}: ${l.trim()}`); });

/* 2) 把模板的四个占位符替换成中性内容，检查骨架语法 */
const skeleton = template
  .replace('@@CONSTS@@', 'const _X = 1;')
  .replace('@@STATE@@', 'let _S = 1;')
  .replace('@@FUNCS@@', 'function _F() {}')
  .replace('@@OPENING_BOOK@@', 'const OPENING_BOOK = {};');
try { new vm.Script(skeleton, { filename: 'skeleton.js' }); console.log('\n模板骨架语法: ✓ OK'); }
catch (e) {
  console.log('\n模板骨架语法: ✗ ' + e.message);
  const m = /skeleton\.js:(\d+)/.exec(e.stack || '');
  if (m) {
    const n = Number(m[1]);
    const ls = skeleton.split('\n');
    console.log('  出错位置附近:');
    for (let i = Math.max(0, n - 4); i < Math.min(ls.length, n + 3); i++) console.log(`    ${i + 1}: ${ls[i]}`);
  }
}

/* 3) 看模块函数段里是否有“注释被切断”的迹象：某个顶层函数提取后以 '*' 开头 */
const mod = fs.readFileSync(path.join(ROOT, 'outputs', 'engine', 'gomoku-ai.js'), 'utf8');
const mLines = mod.split(/\r?\n/);
const iFuncs = mLines.findIndex(l => l.startsWith('/* ---------------- 三、引擎实现'));
const iBook = mLines.findIndex(l => l.startsWith('/* ---------------- 四、开局库'));
console.log(`\n--- 模块函数段 L${iFuncs + 1}~L${iBook} 里“孤立的块注释”检查 ---`);
let suspicious = 0;
for (let i = iFuncs; i < iBook; i++) {
  const l = mLines[i];
  /* 形如以 * 开头、但上一行不是注释起始 的行：可能被切断 */
  if (/^\s*\*/.test(l)) {
    const prev = (mLines[i - 1] || '').trim();
    if (!prev.startsWith('/*') && !prev.startsWith('*') && prev !== '') {
      console.log(`  L${i + 1}: 可疑行 → ${l.trim().slice(0, 70)}   （上一行: ${prev.slice(0, 50)}）`);
      suspicious++;
    }
  }
}
console.log(suspicious ? `  共 ${suspicious} 处可疑` : '  未发现被切断的注释');
