// 验证终端二维码是否真的可扫：把 qr.js 的输出还原成像素，用 jsqr 解码。
//
// 关键点：半块字符（▀▄█）是“把两行压成一行”，因此每个字符纵向代表 2 个模块。
// 还原时必须保证横向/纵向的模块像素尺寸一致，否则解码器找不到定位图案。
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const jsQR = require(path.join(ROOT, 'work', '_qrdept', 'node_modules', 'jsqr', 'dist', 'jsQR.js'));
const decode = typeof jsQR === 'function' ? jsQR : (jsQR.default || jsQR);
const { renderQrText } = require(path.join(ROOT, 'work', 'qr.js'));

const CASES = [
  'http://192.168.1.6:8123/',
  'http://127.0.0.1:8123/?room=AB12C',
  'https://xxxxxxxx.r1.cpolar.cn/?room=AB12C',
];

/** 统一的图像缓冲构造 */
function makeImage(W, H) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    data[i * 4] = 255; data[i * 4 + 1] = 255; data[i * 4 + 2] = 255; data[i * 4 + 3] = 255;
  }
  return data;
}
function fill(data, W, H, x0, y0, w, h) {
  for (let y = y0; y < y0 + h; y++) {
    if (y < 0 || y >= H) continue;
    for (let x = x0; x < x0 + w; x++) {
      if (x < 0 || x >= W) continue;
      const i = (y * W + x) * 4;
      data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 255;
    }
  }
}

/** 把半块字符画还原为像素：unit = 单个模块的像素边长 */
function asciiToImage(ascii, unit) {
  const lines = ascii.split('\n').filter(l => l.length && /[█▀▄ ]/.test(l));
  const cols = Math.max(...lines.map(l => [...l].length));
  const rows = lines.length;
  const W = cols * unit, H = rows * 2 * unit;
  const data = makeImage(W, H);
  lines.forEach((line, li) => {
    const chars = [...line];
    for (let ci = 0; ci < chars.length; ci++) {
      const ch = chars[ci];
      const top = ch === '█' || ch === '▀';
      const bot = ch === '█' || ch === '▄';
      if (top) fill(data, W, H, ci * unit, li * 2 * unit, unit, unit);
      if (bot) fill(data, W, H, ci * unit, (li * 2 + 1) * unit, unit, unit);
    }
  });
  return { data, width: W, height: H };
}

let pass = 0, fail = 0;
for (const text of CASES) {
  const r = renderQrText(text, { quiet: 2 });
  if (!r.ok) { console.log(`✗ ${text} → 生成失败: ${r.reason}`); fail++; continue; }
  let ok = false, tried = [];
  for (const unit of [3, 4, 6, 8, 10, 12]) {
    const img = asciiToImage(r.ascii, unit);
    const res = decode(img.data, img.width, img.height);
    tried.push(`${unit}px:${res ? (res.data === text ? 'ok' : 'mismatch') : 'no'}`);
    if (res && res.data === text) { ok = true; break; }
  }
  if (ok) { console.log(`✓ ${text}`); pass++; }
  else { console.log(`✗ ${text} → 各种缩放都无法解码  [${tried.join(' ')}]`); fail++; }
}
console.log(`\n${pass}/${CASES.length} 通过`);
process.exit(fail ? 1 : 0);
