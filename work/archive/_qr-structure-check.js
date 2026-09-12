// 反证：jsqr 解码器 + 我的图像管线 是否可信？
// 手法：手工构造一个“肯定有效”的二维码矩阵 —— 直接把页面编码器的矩阵与
//       一个已知正确的、由“逐位手算”得到的简单 QR 做对照不可行，
//       因此改为检验解码器在**已知图案**上的行为：
//       用 qr.js 生成矩阵后，把矩阵原样按模块打印成文本，人工/程序逐项检查
//       三个定位图案（Finder）、分隔符、时序图案（Timing）是否合规。
'use strict';
const path = require('path');
const { buildMatrix } = require(path.join(__dirname, 'qr.js'));

const TEXT = 'http://192.168.1.6:8123/';
const m = buildMatrix(TEXT);
const n = m.length;
const P = (r, c) => (r < 0 || c < 0 || r >= n || c >= n) ? 0 : (m[r][c] ? 1 : 0);

console.log(`矩阵 ${n}×${n}（版本 ${(n - 17) / 4}），文本 ${TEXT}`);
console.log('字符画（# = 黑）：');
for (let r = 0; r < n; r++) {
  console.log('  ' + m[r].map(v => v ? '#' : '.').join(''));
}

/* ---------- 格式检查 ---------- */
const bad = [];
/* 1. 三个定位图案：7×7 的 1/0/1/0/1 环，中心 3×3 黑 */
function checkFinder(r0, c0, label) {
  const expect = [
    [1, 1, 1, 1, 1, 1, 1],
    [1, 0, 0, 0, 0, 0, 1],
    [1, 0, 1, 1, 1, 0, 1],
    [1, 0, 1, 1, 1, 0, 1],
    [1, 0, 1, 1, 1, 0, 1],
    [1, 0, 0, 0, 0, 0, 1],
    [1, 1, 1, 1, 1, 1, 1],
  ];
  for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) {
    if (P(r0 + r, c0 + c) !== expect[r][c]) bad.push(`${label} 定位图案不符 @(${r0 + r},${c0 + c})`);
  }
}
checkFinder(0, 0, '左上');
checkFinder(0, n - 7, '右上');
checkFinder(n - 7, 0, '左下');

/* 2. 分隔符（定位图案外侧一圈必须是白） */
for (let i = 0; i < 8; i++) {
  if (P(7, i) !== 0) bad.push(`左上分隔符 @(7,${i}) 应为白`);
  if (P(i, 7) !== 0) bad.push(`左上分隔符 @(${i},7) 应为白`);
  if (P(7, n - 1 - i) !== 0) bad.push(`右上分隔符 @(7,${n - 1 - i}) 应为白`);
  if (P(n - 8, i) !== 0) bad.push(`左下分隔符 @(${n - 8},${i}) 应为白`);
  if (P(n - 1 - i, 7) !== 0) bad.push(`左下分隔符 @(${n - 1 - i},7) 应为白`);
}

/* 3. 时序图案：第 6 行/列在定位图案之间必须 1,0,1,0… 交替（从 (6,8) 起为 1） */
for (let c = 8; c <= n - 9; c++) {
  const expect = (c % 2 === 0) ? 1 : 0;
  if (P(6, c) !== expect) { bad.push(`横向时序 @(6,${c}) 期望 ${expect} 实际 ${P(6, c)}`); break; }
}
for (let r = 8; r <= n - 9; r++) {
  const expect = (r % 2 === 0) ? 1 : 0;
  if (P(r, 6) !== expect) { bad.push(`纵向时序 @(${r},6) 期望 ${expect} 实际 ${P(r, 6)}`); break; }
}

/* 4. 暗模块：固定为黑 */
if (P(n - 8, 8) !== 1) bad.push(`暗模块 @(${n - 8},8) 应为黑`);

console.log('\n---- 结构检查 ----');
if (!bad.length) console.log('✓ 定位图案 / 分隔符 / 时序图案 / 暗模块 全部合规');
else { console.log(`✗ 发现 ${bad.length} 处结构问题：`); bad.slice(0, 12).forEach(b => console.log('   ' + b)); }

/* 5. 格式信息区：QR 规范要求 (8,0..5),(8,7),(8,8),(7,8),(5..0,8) 与 (n-1,8),(n-2,8)… 共 15 位，
 *    且必须与某个合法的 BCH(15,5) 码字（含掩码位）匹配。逐个尝试 32 个合法格式串。 */
function bchFormat(data5) {
  let d = data5 << 10;
  const g = 0b10100110111;
  for (let i = 4; i >= 0; i--) if (d & (1 << (i + 10))) d ^= g << i;
  return ((data5 << 10) | d) ^ 0b101010000010010;
}
const legal = new Set();
for (let d = 0; d < 32; d++) legal.add(bchFormat(d));
/* 读取格式信息（按规范顺序，返回 15 位整数） */
function readFormat() {
  const coords1 = [[8,0],[8,1],[8,2],[8,3],[8,4],[8,5],[8,7],[8,8],[7,8],[5,8],[4,8],[3,8],[2,8],[1,8],[0,8]];
  let v1 = 0;
  for (const [r, c] of coords1) v1 = (v1 << 1) | P(r, c);
  return v1;
}
const f1 = readFormat();
console.log('\n---- 格式信息检查 ----');
console.log(`  第一份格式信息 = 0b${f1.toString(2).padStart(15, '0')} (0x${f1.toString(16)})`);
console.log(`  是否属于合法 BCH 码字集合: ${legal.has(f1) ? '✓ 是' : '✗ 否'}`);
if (!legal.has(f1)) {
  const near = [...legal].map(x => ({ x, d: popcount(x ^ f1) })).sort((a, b) => a.d - b.d)[0];
  console.log(`  与其最接近的合法码字 0b${near.x.toString(2).padStart(15, '0')}，汉明距离 ${near.d}`);
}
function popcount(x) { let n = 0; while (x) { n += x & 1; x >>= 1; } return n; }

console.log('\n结论：若格式信息不是合法 BCH 码字，则二维码必然无法被解码器识别。');
