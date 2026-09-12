// 检查点 1：数据位流是否正确（读出模式指示符与长度字段）。
// QR 字节模式的数据流以 0100（模式）+ 8 位长度（版本 1~9）开头。
// 做法：从矩阵中按规范顺序读出数据位，先解除掩码，再看开头 12 位。
'use strict';
const path = require('path');
const fs = require('fs');
const { buildMatrix } = require(path.join(__dirname, 'qr.js'));

const TEXT = 'http://192.168.1.6:8123/';
const m = buildMatrix(TEXT);
const n = m.length;
const P = (r, c) => (r < 0 || c < 0 || r >= n || c >= n) ? 0 : (m[r][c] ? 1 : 0);

/* 读取格式信息里的纠错级别与掩码号 */
function popcount(x) { let k = 0; while (x) { k += x & 1; x >>= 1; } return k; }
function bchFormat(d5) { let d = d5 << 10; const g = 0b10100110111; for (let i = 4; i >= 0; i--) if (d & (1 << (i + 10))) d ^= g << i; return ((d5 << 10) | d) ^ 0b101010000010010; }
const coords1 = [[8,0],[8,1],[8,2],[8,3],[8,4],[8,5],[8,7],[8,8],[7,8],[5,8],[4,8],[3,8],[2,8],[1,8],[0,8]];
let f1 = 0; for (const [r, c] of coords1) f1 = (f1 << 1) | P(r, c);
let best = null;
for (let d = 0; d < 32; d++) { const x = bchFormat(d); const dist = popcount(x ^ f1); if (!best || dist < best.dist) best = { d, x, dist }; }
const eclBits = (best.d >> 3) & 0b11;     // 2 位：L/M/Q/H
const maskId = best.d & 0b111;            // 3 位掩码号
const ECL = ['M', 'L', 'H', 'Q'][eclBits]; // 规范映射（本编码器按 M 写入）
console.log(`格式信息解码：纠错级别位=${eclBits}（M 对应 0b00）掩码号=${maskId} 汉明距离=${best.dist}`);
if (best.dist !== 0) console.log('  !! 格式信息不是精确匹配的合法码字');

/* 掩码函数（规范 8 种） */
const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r, c) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

/* 功能图案占用区（用于跳过）：定位/分隔/时序/对准/格式/版本 */
const reserved = Array.from({ length: n }, () => Array(n).fill(false));
function markRect(r0, c0, h, w) { for (let r = r0; r < r0 + h; r++) for (let c = c0; c < c0 + w; c++) if (r >= 0 && c >= 0 && r < n && c < n) reserved[r][c] = true; }
markRect(0, 0, 9, 9); markRect(0, n - 8, 9, 8); markRect(n - 8, 0, 8, 9);   // 三个角 + 格式信息
for (let i = 0; i < n; i++) { reserved[6][i] = true; reserved[i][6] = true; }  // 时序
/* 版本 2 的对准图案在 (18,18)，覆盖 16..20 */
if (n >= 25) markRect(n - 9, n - 9, 5, 5);

/* 按规范顺序（纵向蛇形、从右下开始、每列两格）读数据位 */
const bits = [];
let upward = true;
for (let col = n - 1; col > 0; col -= 2) {
  if (col === 6) col--;                       // 跳过纵向时序列
  for (let k = 0; k < n; k++) {
    const r = upward ? (n - 1 - k) : k;
    for (const c of [col, col - 1]) {
      if (reserved[r][c]) continue;
      bits.push(P(r, c));
    }
  }
  upward = !upward;
}
console.log(`读出数据位 ${bits.length} 位（版本 ${(n - 17) / 4} 的数据容量应为 44 字节 = 352 位，含纠错码字则更多）`);

/* 解除掩码 */
const un = bits.map((b, i) => {
  /* 需要知道位所在的 (r,c) 才能应用掩码，这里重建坐标 */
  return b;
});
/* 重建带坐标的读取 */
const bitsWithPos = [];
upward = true;
for (let col = n - 1; col > 0; col -= 2) {
  if (col === 6) col--;
  for (let k = 0; k < n; k++) {
    const r = upward ? (n - 1 - k) : k;
    for (const c of [col, col - 1]) {
      if (reserved[r][c]) continue;
      bitsWithPos.push({ r, c, v: P(r, c) });
    }
  }
  upward = !upward;
}
const maskFn = MASKS[maskId];
const dataBits = bitsWithPos.map(({ r, c, v }) => (maskFn(r, c) ? (v ^ 1) : v));

const head = dataBits.slice(0, 4).join('');
const len = parseInt(dataBits.slice(4, 12).join(''), 2);
console.log(`\n数据流开头：模式指示符 = ${head}（字节模式应为 0100）`);
console.log(`            长度字段 = ${len}（应为 ${Buffer.byteLength(TEXT, 'utf8')} 字节）`);

/* 还原前若干字节，与原文比较 */
let bytes = [];
for (let i = 0; i + 8 <= dataBits.length && bytes.length < 40; i += 8) {
  bytes.push(parseInt(dataBits.slice(i, i + 8).join(''), 2));
}
/* 前 12 位是头，之后是数据 */
const payloadBytes = [];
for (let i = 12; i + 8 <= dataBits.length; i += 8) payloadBytes.push(parseInt(dataBits.slice(i, i + 8).join(''), 2));
const decoded = Buffer.from(payloadBytes.slice(0, len)).toString('utf8');
console.log(`           还原载荷 = ${JSON.stringify(decoded)}`);
console.log(`           期望载荷 = ${JSON.stringify(TEXT)}`);
console.log(`\n判定：${head === '0100' && len === Buffer.byteLength(TEXT, 'utf8') && decoded === TEXT ? '✓ 数据位流正确（问题在纠错码/交织）' : '✗ 数据位流有问题'}`);

/* 打印前 48 位方便比对 */
console.log('\n数据流前 48 位: ' + dataBits.slice(0, 48).join(''));
