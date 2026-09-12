// 逐层定位：内嵌 QR 编码器在哪个输入长度/版本上开始失效？
// 对每个版本取一个刚好触发该版本的文本，检查：
//   ① 矩阵是否生成   ② 数据位流是否正确   ③ jsqr 能否解码
'use strict';
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const jsQR = require(path.join(ROOT, 'work', '_qrdept', 'node_modules', 'jsqr', 'dist', 'jsQR.js'));
const decode = typeof jsQR === 'function' ? jsQR : (jsQR.default || jsQR);
const { buildMatrix } = require(path.join(ROOT, 'work', 'qr.js'));

/* 版本 v 的字节净容量（与编码器同一公式） */
const BLOCKS = { 1: [[16,10]], 2: [[28,16]], 3: [[44,26]], 4: [[32,18],[32,18]], 5: [[43,24],[43,24]],
  6: [[27,16],[27,16],[27,16],[27,16]], 7: [[31,18],[31,18],[31,18],[31,18]],
  8: [[38,22],[38,22],[39,22],[39,22]], 9: [[36,22],[36,22],[36,22],[37,22],[37,22]],
  10: [[43,26],[43,26],[43,26],[43,26],[44,26]] };
function cap(v) { const d = BLOCKS[v].reduce((a, b) => a + b[0], 0); const ov = v <= 9 ? 12 : 20; return Math.floor((d * 8 - ov) / 8); }

/** 把矩阵渲染成像素并用 jsqr 解码 */
function decodeMatrix(m, unit, quiet) {
  const s = unit || 6, q = quiet == null ? 4 : quiet;
  const n = m.length;
  const W = (n + q * 2) * s;
  const data = new Uint8ClampedArray(W * W * 4);
  for (let i = 0; i < W * W; i++) { data[i*4]=255; data[i*4+1]=255; data[i*4+2]=255; data[i*4+3]=255; }
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (!m[r][c]) continue;
    const x0 = (c + q) * s, y0 = (r + q) * s;
    for (let y = y0; y < y0 + s; y++) for (let x = x0; x < x0 + s; x++) {
      const i = (y * W + x) * 4; data[i]=0; data[i+1]=0; data[i+2]=0; data[i+3]=255;
    }
  }
  return decode(data, W, W);
}

console.log('版本 | 文本长度 | 矩阵尺寸 | 生成 | jsqr 解码 | 结果');
let firstBad = null;
for (let v = 1; v <= 10; v++) {
  const len = cap(v);                                   // 用该版本的满载长度，确保落在该版本
  const text = 'A'.repeat(len);
  const m = buildMatrix(text);
  const size = m ? m.length : 0;
  const expectedSize = 17 + 4 * v;
  const sizeOk = size === expectedSize;
  let dec = null;
  if (m) dec = decodeMatrix(m, 6, 4);
  const decOk = dec && dec.data === text;
  const good = m && sizeOk && decOk;
  if (!good && firstBad === null) firstBad = { v, len, size, expectedSize, dec: dec ? dec.data.length + ' 字节(不符)' : '解码失败' };
  console.log(`${String(v).padStart(3)}  | ${String(len).padStart(7)} | ${String(size).padStart(6)}${sizeOk ? '' : `(应${expectedSize})`} | ${m ? ' ✓ ' : ' ✗ '} | ${decOk ? '   ✓    ' : '   ✗    '} | ${good ? '可用' : '**不可用**'}`);
}
console.log('');
if (firstBad) {
  console.log(`最早失效的版本：v${firstBad.v}（文本 ${firstBad.len} 字节，矩阵 ${firstBad.size} 应为 ${firstBad.expectedSize}，${firstBad.dec}）`);
} else {
  console.log('v1~v10 全部可解码');
}

/* 再单独测一个固定的短文本 v1 情况 */
console.log('\n---- 短文本（v1）单独验证 ----');
for (const t of ['A', 'AB', 'http://a.b/', 'http://192.168.1.6:8123/']) {
  const m = buildMatrix(t);
  if (!m) { console.log(`  ${JSON.stringify(t)} → 未生成`); continue; }
  const d = decodeMatrix(m, 8, 4);
  console.log(`  ${JSON.stringify(t)} → 矩阵 ${m.length}×${m.length}，解码 ${d ? (d.data === t ? '✓ 一致' : '✗ 不一致: ' + JSON.stringify(d.data)) : '✗ 失败'}`);
}
