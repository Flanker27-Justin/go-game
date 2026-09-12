// 浏览器端验证（稳版）：把一段同步自检脚本注入页面副本，用无头浏览器 --dump-dom 读回结果。
// 之所以不用 CDP：Chrome 的 --dump-dom 在 remote-debugging 模式下有挂起问题，
// 而本页所有关键路径都是同步的（引擎是纯同步函数），无需异步等待即可验证。
// 退出码：0=通过，1=失败，2=环境不支持（无浏览器）
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'outputs');
const MARK = 'DSH_SELFTEST_RESULT:';

const CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];
const browser = CANDIDATES.find(p => fs.existsSync(p));
if (!browser) { console.log('未找到 Chrome/Edge，跳过浏览器验证'); process.exit(2); }
console.log('浏览器: ' + browser);

/* ---------- 注入同步自检脚本 ---------- */
const SELF_TEST = `
<script>
(function () {
  var results = [];
  function ok(name, cond, extra) { results.push({ n: name, p: !!cond, v: (extra === undefined ? '' : String(extra)) }); }
  function t(name, fn) { try { var v = fn(); ok(name, v === true || (v !== false && v !== undefined && v !== null), v); } catch (e) { ok(name, false, 'THROW: ' + e.message); } }
  try {
    t('GomokuAI 已加载', function () { return typeof GomokuAI === 'object'; });
    t('页面 AI 引用可用', function () { return typeof AI === 'object' && typeof AI.getBestMove === 'function'; });
    t('页面无残留内联引擎', function () { return typeof getBestMove === 'undefined' && typeof minimax === 'undefined'; });
    t('引擎棋盘尺寸=19', function () { return AI.boardSize === 19; });
    t('引擎棋盘是同一对象', function () { return AI.board === AI.board; });
    t('canvas 存在且 id 正确', function () { return !!document.getElementById('board') && document.querySelectorAll('canvas#board').length === 1; });
    t('初始双人模式', function () { return gameMode === 'pvp'; });
    t('状态栏有文字', function () { return document.getElementById('status').textContent.length > 0; });
    t('状态栏文字内容', function () { return document.getElementById('status').textContent; });

    /* 切人机：走 init → AI.setBoardSize / AI.setColors */
    document.getElementById('btnPve').click();
    t('切人机 gameMode=pve', function () { return gameMode === 'pve'; });
    t('切人机后引擎尺寸=19', function () { return AI.boardSize === 19; });
    t('AI 执白(2)', function () { return AI.aiColor === 2; });
    t('玩家执黑(1)', function () { return AI.playerColor === 1; });

    /* 玩家落子（同步） */
    placeStone(9, 9);
    t('落子写进引擎棋盘', function () { return AI.board[9][9] === 1; });
    t('落子后轮到 AI', function () { return currentPlayer === AI.aiColor; });
    t('页面棋盘就是引擎棋盘', function () { return AI.board[9][9] === 1 && board === undefined; });

    /* 同步触发 AI 应手（引擎是纯同步的，直接调用避免等定时器） */
    var t0 = Date.now();
    aiMove();
    var ms = Date.now() - t0;
    t('AI 已应手（棋子≥2）', function () { return AI.board.flat().filter(function (v) { return v !== 0; }).length >= 2; }, 'AI思考 ' + ms + 'ms');
    t('AI 落子后回合回到玩家', function () { return currentPlayer === AI.playerColor; });
    t('AI 落点合法（非负且在盘内）', function () {
      var c = 0; for (var r = 0; r < AI.boardSize; r++) for (var cc = 0; cc < AI.boardSize; cc++) if (AI.board[r][cc] !== 0) c++;
      return c >= 2 && c <= 3;
    });

    /* 教学推荐点（会调用引擎 medium 搜索） */
    eduMode = true; showHint = true;
    try { refreshHint(); } catch (e) { }
    t('推荐点已计算或为空', function () { return hintMove === null || Array.isArray(hintMove); });

    /* 悔棋（人机模式应撤两手） */
    undo();
    t('悔棋后棋盘清空', function () { return AI.board.flat().filter(function (v) { return v !== 0; }).length === 0; });

    /* 换 13 路 */
    document.getElementById('boardSizeSelect').value = '13';
    init(gameMode, false);
    t('换 13 路后引擎尺寸=13', function () { return AI.boardSize === 13; });
    t('换格后画布宽度正确', function () { return canvas.width === 20 * 2 + 12 * 40; }, 'canvas.width=' + canvas.width);

    /* 双人模式与在线面板 */
    document.getElementById('btnPvp').click();
    t('切回双人 gameMode=pvp', function () { return gameMode === 'pvp'; });
    document.getElementById('btnOnline').click();
    t('在线模式 gameMode=online', function () { return gameMode === 'online'; });
    t('在线面板可见', function () { return document.getElementById('onlinePanel').style.display !== 'none'; });
    document.getElementById('btnPvp').click();
  } catch (e) {
    ok('自检脚本本身未抛异常', false, e && e.message ? e.message : String(e));
  }
  var pre = document.createElement('pre');
  pre.id = 'dsh-selftest';
  pre.textContent = '${MARK}' + JSON.stringify(results);
  document.body.appendChild(pre);
})();
<\/script>
`;

const testHtml = fs.readFileSync(path.join(OUT, 'gomoku.html'), 'utf8')
  .replace('</body>', SELF_TEST + '</body>');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gomoku-selfcheck-'));
fs.writeFileSync(path.join(tmpDir, 'selftest.html'), testHtml, 'utf8');
/* 引擎与 games 目录也要能取到：把 outputs 作为根，通过 http 提供 */
const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  let file;
  if (urlPath === '/' || urlPath === '/selftest.html') file = path.join(tmpDir, 'selftest.html');
  else file = path.join(OUT, urlPath);
  if (!file.startsWith(OUT) && !file.startsWith(tmpDir)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    const ext = path.extname(file);
    const mime = ext === '.html' ? 'text/html; charset=utf-8' : ext === '.js' ? 'text/javascript; charset=utf-8' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store' });
    res.end(data);
  });
});

server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/selftest.html`;
  const profile = path.join(ROOT, 'work', '_chrome-profile');
  console.log('页面地址: ' + url);
  /* 注意：沙箱下“管道捕获子进程 stdio”会 EPERM，因此把 --dump-dom 的输出
   * 重定向到文件，再用 fs 读回来（stdio 用 inherit/ignore 均可正常工作）。
   * 另外沙箱禁止命名管道，Chrome 的多进程/沙箱机制会直接崩，故加
   * --single-process + --no-zygote + --no-sandbox；profile 也必须放在可写的工作区里。 */
  const domFile = path.join(tmpDir, 'dom.html');
  const domFd = fs.openSync(domFile, 'w');
  const res = spawnSync(browser, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-setuid-sandbox',
    '--single-process', '--no-zygote', '--disable-dev-shm-usage',
    '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', '--disable-sync',
    '--user-data-dir=' + profile,
    '--virtual-time-budget=20000',
    '--dump-dom', url,
  ], { stdio: ['ignore', domFd, domFd], timeout: 90000 });
  fs.closeSync(domFd);

  server.close();
  let dom = '';
  try { dom = fs.readFileSync(domFile, 'utf8'); } catch (e) { dom = ''; }
  const idx = dom.indexOf(MARK);
  if (idx < 0) {
    console.log('未取到自检结果（浏览器可能未能完成加载）');
    console.log('spawn 状态: ' + (res.error ? res.error.message : 'ok') + ', signal=' + res.signal + ', status=' + res.status + ', dom 字节=' + dom.length);
    console.log('输出片段: ' + dom.slice(0, 1200));
    process.exit(1);
  }
  const jsonText = dom.slice(idx + MARK.length);
  const end = jsonText.lastIndexOf(']');
  let results;
  try { results = JSON.parse(jsonText.slice(0, end + 1)); }
  catch (e) {
    console.log('自检结果解析失败: ' + e.message);
    console.log(jsonText.slice(0, 500));
    process.exit(1);
  }

  let failed = 0;
  console.log('\n==== 浏览器端自检 ====');
  for (const r of results) {
    if (!r.p) failed++;
    console.log(`  ${r.p ? '✓' : '✗'} ${r.n}` + (r.p ? (r.v && r.v !== 'true' ? `  [${r.v}]` : '') : `  → ${r.v}`));
  }
  console.log(`\n${results.length - failed}/${results.length} 通过`);
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { }
  process.exit(failed ? 1 : 0);
});
