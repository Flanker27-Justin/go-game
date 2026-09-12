// 把 work/qr.js 生成的二维码写成 PNG（零依赖，手写最小 PNG 编码器），
// 便于用图片查看直接肉眼确认二维码是否正确。
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { buildMatrix } = require(path.join(__dirname, 'qr.js'));

/* ---------- 最小 PNG 编码器（灰度 8bit） ---------- */
function crc32(buf) {
  let c, crc = 0xFFFFFFFF;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xFF;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const body = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
/** pixels: Uint8Array 灰度值，width/height */
function encodePng(pixels, width, height) {
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0;                       // filter: none
    for (let x = 0; x < width; x++) raw[y * (width + 1) + 1 + x] = pixels[y * width + x];
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 0;    // color type: grayscale
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------- 用矩阵渲染 PNG ---------- */
const text = process.argv[2] || 'http://192.168.1.6:8123/';
const scale = Number(process.argv[3] || 8);
const quiet = 4;
const m = buildMatrix(text);
if (!m) { console.error('生成失败（内容过长）'); process.exit(1); }
const n = m.length;
const W = (n + quiet * 2) * scale;
const H = W;
const px = new Uint8Array(W * H).fill(255);
for (let r = 0; r < n; r++) {
  for (let c = 0; c < n; c++) {
    if (!m[r][c]) continue;
    const x0 = (c + quiet) * scale, y0 = (r + quiet) * scale;
    for (let y = y0; y < y0 + scale; y++) for (let x = x0; x < x0 + scale; x++) px[y * W + x] = 0;
  }
}
console.log(`二维码矩阵 ${n}×${n}（版本 ${(n - 17) / 4}），PNG ${W}×${W}`);
console.log('内容: ' + text);

/* ---------- 额外：把 qr.js 的 ASCII 输出也还原成 PNG，用于确认终端显示是否可扫 ---------- */
if (process.argv.includes('--ascii')) {
  const { renderQrText } = require(path.join(__dirname, 'qr.js'));
  const r = renderQrText(text, { quiet: 2 });
  if (!r.ok) { console.error('ASCII 生成失败: ' + r.reason); process.exit(1); }
  const lines = r.ascii.split('\n').filter(l => l.length && /[█▀▄ ]/.test(l));
  const cols = Math.max(...lines.map(l => [...l].length));
  const u = 6;                                  // 每个模块 6×6 像素
  const AW = cols * u, AH = lines.length * 2 * u;
  const apx = new Uint8Array(AW * AH).fill(255);
  lines.forEach((line, li) => {
    [...line].forEach((ch, ci) => {
      const top = ch === '█' || ch === '▀';
      const bot = ch === '█' || ch === '▄';
      const paint = (y0) => { for (let y = y0; y < y0 + u; y++) for (let x = ci * u; x < ci * u + u; x++) if (y < AH && x < AW) apx[y * AW + x] = 0; };
      if (top) paint(li * 2 * u);
      if (bot) paint((li * 2 + 1) * u);
    });
  });
  const outA = path.join(__dirname, 'archive', '_qr-preview-ascii.png');
  require('fs').writeFileSync(outA, encodePng(apx, AW, AH));
  console.log(`ASCII 还原图: ${AW}×${AH}（字符列 ${cols}，行 ${lines.length}）→ ` + path.relative(path.resolve(__dirname, '..'), outA));
}

const out = path.join(__dirname, 'archive', '_qr-preview.png');
fs.writeFileSync(out, encodePng(px, W, H));
console.log('已写出: ' + path.relative(path.resolve(__dirname, '..'), out));
