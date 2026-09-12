// 终端二维码生成器：复用 gomoku.html 里内嵌的 QR 编码器（零依赖）。
//
// 动机：一键启动后要把「手机怎么进来」讲清楚。让用户手敲 http://192.168.x.x:8123/
// 很容易出错，直接在终端打出二维码，手机扫一下就能进。
//
// 实现：从 gomoku.html 中按注释锚点整段抽取 QR 相关函数与常量表
// （版本 1~10 / 纠错 M / 字节模式），套上工厂函数注入依赖，再用半块字符渲染。
//
// 用法（命令行）: node work/qr.js "<文本>" [--no-border]
// 用法（模块）  : const { renderQrText, buildMatrix } = require('./work/qr.js')
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const HTML = path.join(ROOT, 'outputs', 'gomoku.html');

/* ---------- 1. 从页面抽取 QR 实现（按注释锚点整段取） ---------- */
function loadMatrixBuilder() {
  const src = fs.readFileSync(HTML, 'utf8');
  const START = '/* ============================================================\n * 内嵌 QR 编码器';
  const END = '/* ---------------- 邀请链接';
  const i0 = src.indexOf(START);
  const i1 = src.indexOf(END);
  if (i0 < 0 || i1 < 0 || i1 <= i0) throw new Error('无法在 gomoku.html 中定位 QR 编码器区块');
  const qrRegion = src.slice(i0, i1);
  if (!qrRegion.includes('function buildQrMatrix(')) throw new Error('QR 区块里没有 buildQrMatrix');
  const factory = new Function(`'use strict';\n${qrRegion}\nreturn { buildQrMatrix };`);
  const api = factory();
  if (typeof api.buildQrMatrix !== 'function') throw new Error('buildQrMatrix 不可用');
  return api.buildQrMatrix;
}

let buildMatrix = null;
function getBuilder() {
  if (!buildMatrix) buildMatrix = loadMatrixBuilder();
  return buildMatrix;
}

/* ---------- 2. 渲染：半块字符 ▀▄█ 把两行压成一行，终端里更紧凑 ----------
 * ★ 白边（quiet zone）必须是**空白字符**：QR 规范要求四周留 4 个模块的浅色边，
 *   解码器靠这个边界定位。曾用实心方块 '█' 当边框，等于给二维码加了一圈黑框，
 *   导致完全无法解码（看着像边框，实际是致命错误）。 */
function renderMatrix(matrix, opts) {
  const quiet = opts && opts.quiet != null ? opts.quiet : 2;   // 竖向以“字符行”计，1 行 = 2 模块
  const n = matrix.length;
  const out = [];
  const blank = (w) => ' '.repeat(w);
  for (let i = 0; i < quiet; i++) out.push('  ' + blank(n + quiet * 2));
  for (let r = 0; r < n; r += 2) {
    let line = '  ' + blank(quiet);
    for (let c = 0; c < n; c++) {
      const top = matrix[r][c] ? 1 : 0;
      const bot = (r + 1 < n && matrix[r + 1][c]) ? 1 : 0;
      line += top && bot ? '█' : top ? '▀' : bot ? '▄' : ' ';
    }
    line += blank(quiet);
    out.push(line);
  }
  for (let i = 0; i < quiet; i++) out.push('  ' + blank(n + quiet * 2));
  return out.join('\n');
}

/** 生成文本对应的二维码矩阵（失败返回 null，通常是内容过长） */
function build(text) { return getBuilder()(text); }

/**
 * 生成可直接打印的二维码字符画。
 * @returns {{ ok: boolean, ascii?: string, reason?: string }}
 */
function renderQrText(text, opts) {
  if (!text) return { ok: false, reason: '文本为空' };
  let m;
  try { m = build(text); }
  catch (e) { return { ok: false, reason: '编码器异常: ' + e.message }; }
  if (!m) {
    return { ok: false, reason: `内容超出内嵌编码器容量（约 213 字节 / 版本 10），当前 ${Buffer.byteLength(text, 'utf8')} 字节` };
  }
  return { ok: true, ascii: renderMatrix(m, opts || {}) };
}

module.exports = { renderQrText, renderMatrix, buildMatrix: build, loadMatrixBuilder };

/* ---------- 3. 命令行入口 ---------- */
if (require.main === module) {
  const text = process.argv[2];
  if (!text) {
    console.error('用法: node work/qr.js "<文本>"');
    process.exit(2);
  }
  const noBorder = process.argv.includes('--no-border');
  const r = renderQrText(text, { quiet: noBorder ? 0 : 2 });
  if (!r.ok) { console.error(r.reason); process.exit(1); }
  console.log(r.ascii);
  console.log('  ' + text);
}
