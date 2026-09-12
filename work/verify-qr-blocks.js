// 校验 gomoku.html 内嵌 QR 编码器的分块表是否与 ISO/IEC 18004 一致。
// 结论用于判断“扫码入局”功能是否真的可用（此前实测：生成的二维码无法被解码器识别）。
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'outputs', 'gomoku.html'), 'utf8');

/* 抽取编码器的 QR_BLOCKS 表（用括号配平，避免正则被注释与嵌套数组干扰） */
const start = src.indexOf('const QR_BLOCKS = {');
if (start < 0) { console.error('未找到 QR_BLOCKS'); process.exit(2); }
const braceStart = src.indexOf('{', start);
let depth = 0, end = -1;
for (let i = braceStart; i < src.length; i++) {
  if (src[i] === '{') depth++;
  else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
}
if (end < 0) { console.error('QR_BLOCKS 未闭合'); process.exit(2); }
const literal = src.slice(braceStart, end).replace(/\/\/[^\n]*/g, '');   // 去掉行注释
let impl;
try { impl = eval('(' + literal + ')'); }                                  // 对象字面量（键未加引号）
catch (e) { console.error('解析 QR_BLOCKS 失败: ' + e.message); process.exit(2); }

/* ISO/IEC 18004 纠错级别 M 的 [总码字数, 数据码字数, 纠错码字数, 块数]
 * 数据来源：QR 规范表 9（version 1~10, level M） */
const SPEC_M = {
  1:  { total: 26, data: 16, ecc: 10, blocks: 1 },
  2:  { total: 44, data: 28, ecc: 16, blocks: 1 },
  3:  { total: 70, data: 44, ecc: 26, blocks: 1 },
  4:  { total: 100, data: 64, ecc: 18, blocks: 2 },   // 2 块 × 32 数据
  5:  { total: 134, data: 86, ecc: 24, blocks: 2 },   // 2 块 × 43 数据
  6:  { total: 172, data: 108, ecc: 16, blocks: 4 },  // 4 块 × 27 数据
  7:  { total: 196, data: 124, ecc: 18, blocks: 4 },  // 4 块 × 31 数据
  8:  { total: 242, data: 154, ecc: 22, blocks: 4 },  // 2×38 + 2×39
  9:  { total: 292, data: 182, ecc: 22, blocks: 5 },  // 3×36 + 2×37
  10: { total: 346, data: 216, ecc: 26, blocks: 5 },  // 4×43 + 1×44
};

console.log('==== 编码器 QR_BLOCKS 与规范对照（纠错级别 M）====');
console.log('版本 | 编码器 [数据,纠错]×块数        | 规范 [数据,纠错]×块数          | 数据码字 合计 | 判定');
const problems = [];
for (let v = 1; v <= 10; v++) {
  const implSpec = impl[v] || [];
  const implDesc = implSpec.map(b => `[${b[0]},${b[1]}]`).join('×');
  const implData = implSpec.reduce((a, b) => a + b[0], 0);
  const implEcc = implSpec.reduce((a, b) => a + b[1], 0);
  const s = SPEC_M[v];
  /* 规范的块划分（仅比较总数与每块结构是否自洽） */
  const specData = s.data, specEcc = s.ecc, specTotal = s.total;
  const okData = implData === specData;
  const okTotal = (implData + implEcc) === specTotal;
  const ok = okData && okTotal;
  if (!ok) {
    problems.push({ v, implData, implEcc, implTotal: implData + implEcc, specData, specEcc, specTotal });
  }
  console.log(`${String(v).padStart(3)}  | ${implDesc.padEnd(28)} | 规范数据 ${String(specData).padStart(3)} 纠错 ${String(specEcc).padStart(3)}（总 ${specTotal}） | ${String(implData).padStart(3)} / 应为 ${String(specData).padStart(3)} | ${ok ? '✓' : '✗ 不符'}`);
}

console.log(`\n发现 ${problems.length} 个版本的分块表与规范不一致：`);
for (const p of problems) {
  console.log(`  版本 ${p.v}: 编码器 数据 ${p.implData} + 纠错 ${p.implEcc} = ${p.implTotal} 码字；规范应为 数据 ${p.specData} + 纠错 ${p.specEcc} = ${p.specTotal} 码字` +
    (p.implData + p.implEcc === p.specTotal ? '（总容量对，但数据/纠错分配或块结构不对）' : '（总容量也不对）'));
}

/* 额外：检查“编码器 v 的数据码字数”是否等于“规范 v-1 的数据码字数”，用于佐证整体错位一档 */
console.log('\n---- 错位假设检验：编码器 v 的数据码字数是否 = 规范 v-1 的数据码字数 ----');
let shiftHits = 0, shiftTotal = 0;
for (let v = 2; v <= 10; v++) {
  const implData = (impl[v] || []).reduce((a, b) => a + b[0], 0);
  const prev = SPEC_M[v - 1].data;
  const hit = implData === prev;
  if (hit) shiftHits++;
  shiftTotal++;
  console.log(`  v${v}: 编码器数据 ${implData} vs 规范 v${v - 1} 数据 ${prev} → ${hit ? '相等' : '不等'}`);
}
console.log(`\n错位假设：${shiftHits}/${shiftTotal} 个版本满足“编码器 v = 规范 v-1”，` +
  (shiftHits >= 7 ? '**强烈支持「整体错位一档」的判断**' : '证据不足'));
process.exit(problems.length ? 1 : 0);
