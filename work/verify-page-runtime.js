// 页面运行时验证（不依赖浏览器）：把 gomoku.html 的内联脚本放进 vm 沙箱真实执行，
// 用 Proxy 做 DOM 桩，跑通「init → 落子 → AI 应手 → 悔棋 → 换格」关键路径。
//
// 为什么不用无头浏览器：本机沙箱禁止命名管道，Chrome 的 mojo IPC 无法建立
// （platform_channel Check failed: 拒绝访问），headless 模式起不来。
// 本脚本用"真执行 + 假 DOM"覆盖同一批逻辑，能抓到未定义变量、类型错误、
// 引擎 API 用错、初始化流程断裂等问题。
// 用法: node work/verify-page-runtime.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'outputs', 'gomoku.html'), 'utf8');

/* ---------- 1. 抽出内联脚本（页面上有且应只有这一个 <script>…</script>） ---------- */
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
if (scripts.length !== 1) {
  console.log(`✗ 期望恰好 1 个内联 <script>，实际 ${scripts.length} 个`);
  process.exit(1);
}
const pageCode = scripts[0];
console.log(`内联脚本: ${pageCode.split('\n').length} 行 / ${(Buffer.byteLength(pageCode, 'utf8') / 1024).toFixed(1)}KB`);

/* ---------- 2. DOM 桩 ---------- */
const results = [];
const ok = (name, cond, extra) => results.push({ name, ok: !!cond, extra });

/** 通用元素桩：任何属性访问都返回一个可调用、可当对象用的 Proxy */
function makeElement(id) {
  const store = { id, style: {}, classList: { add() { }, remove() { }, toggle() { }, contains() { return false; } }, dataset: {} };
  const noop = function () { return undefined; };
  const ctx2d = new Proxy({}, {
    get(t, k) {
      if (k === 'canvas') return store;
      if (k === 'measureText') return () => ({ width: 10 });
      if (k in t) return t[k];
      return noop;
    },
    set(t, k, v) { t[k] = v; return true; },
  });
  const handler = {
    get(t, k) {
      if (k in store) return store[k];
      if (k === 'getContext') return () => ctx2d;
      if (k === 'getBoundingClientRect') return () => ({ left: 0, top: 0, width: 760, height: 760 });
      if (k === 'addEventListener' || k === 'removeEventListener') return noop;
      if (k === 'appendChild' || k === 'append' || k === 'insertBefore') return noop;
      if (k === 'querySelector' || k === 'querySelectorAll') return () => (k === 'querySelectorAll' ? [] : makeElement(id + '-child'));
      if (k === 'focus' || k === 'blur' || k === 'click' || k === 'remove') return noop;
      if (k === 'value' || k === 'textContent' || k === 'innerHTML' || k === 'checked' || k === 'disabled') return store[k];
      return makeElement(id + '.' + String(k));
    },
    set(t, k, v) { store[k] = v; return true; },
    has() { return true; },
  };
  return new Proxy(store, handler);
}

const registry = new Map();
function getEl(id) {
  if (!registry.has(id)) registry.set(id, makeElement(id));
  return registry.get(id);
}
/* 关键元素的初值要贴近真实页面 */
getEl('boardSizeSelect').value = '19';
getEl('aiLevelSelect').value = 'medium';
getEl('gameSelect').value = 'gomoku';
getEl('eduModeToggle').checked = false;
getEl('showHintToggle').checked = true;
getEl('guessFirstToggle').checked = true;
getEl('winRateToggle').checked = true;
getEl('board').width = 760;
getEl('board').height = 760;

const documentStub = {
  getElementById: (id) => getEl(id),
  querySelector: () => makeElement('q'),
  querySelectorAll: () => [],
  createElement: (tag) => makeElement(tag),
  addEventListener: () => { },
  removeEventListener: () => { },
  body: makeElement('body'),
  documentElement: makeElement('html'),
  activeElement: null,
  hidden: false,
};

/* ---------- 3. 沙箱 ---------- */
const sandbox = {
  console,
  setTimeout: (fn, ms) => setTimeout(fn, 0),   // 不让测试等待
  clearTimeout,
  setInterval: () => 0,
  clearInterval,
  requestAnimationFrame: (fn) => setTimeout(fn, 0),
  cancelAnimationFrame: clearTimeout,
  document: documentStub,
  navigator: { userAgent: 'node', clipboard: { writeText: async () => { } }, mediaDevices: { getUserMedia: async () => ({}) } },
  location: { protocol: 'http:', host: '127.0.0.1:8123', search: '', href: 'http://127.0.0.1:8123/' },
  history: { replaceState() { } },
  sessionStorage: { getItem: () => null, setItem: () => { }, removeItem: () => { } },
  localStorage: { getItem: () => null, setItem: () => { }, removeItem: () => { } },
  performance: { now: () => Date.now() },
  URLSearchParams,
  WebSocket: function () { return { readyState: 3, send() { }, close() { } }; },
  RTCPeerConnection: function () { return { addIceCandidate() { }, createOffer: async () => ({ sdp: '' }), setLocalDescription: async () => { }, close() { } }; },
  alert: () => { }, confirm: () => false, prompt: () => null,
  fetch: async () => ({ ok: true, json: async () => ({}) }),
  Image: function () { return makeElement('img'); },
  btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  atob: (s) => Buffer.from(s, 'base64').toString('binary'),
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.self = sandbox;

/* 载入真实引擎模块（浏览器里由 <script src> 提供 window.GomokuAI） */
const enginePath = path.join(ROOT, 'outputs', 'engine', 'gomoku-ai.js');
const engineSrc = fs.readFileSync(enginePath, 'utf8');
const context = vm.createContext(sandbox);
try {
  vm.runInContext(engineSrc, context, { filename: 'engine/gomoku-ai.js' });
} catch (e) {
  console.log('✗ 引擎模块在沙箱中执行失败: ' + e.message);
  process.exit(1);
}
ok('引擎模块可在沙箱执行', typeof sandbox.GomokuAI === 'object');

/* 执行页面脚本（会跑到底部的 registerGame / switchGame / init 流程）。
 * ★ 注意：经典脚本里的顶层 const/let（const AI、let gameMode…）不会成为
 *   全局对象属性（只有 var/function 才会），所以不能通过 sandbox.xxx 读取。
 *   这里改为在同一次 runInContext 的词法作用域内追加一段探针代码，
 *   把值挂到 sandbox.__probe 上——探针只是在测试副本里追加，不改动仓库文件。 */
const PROBE = `
;globalThis.__probe = {
  get: function (name) {
    switch (name) {
      case 'gameMode': return gameMode;
      case 'currentPlayer': return currentPlayer;
      case 'gameOver': return gameOver;
      case 'winLine': return winLine;
      case 'hintMove': return hintMove;
      case 'eduMode': return eduMode;
      case 'boardSize': return boardSize;
      case 'moveCount': return moveCount;
      case 'AI_isObject': return typeof AI === 'object';
      case 'AI_getBestMove': return typeof AI.getBestMove === 'function';
      case 'bare_getBestMove': return typeof getBestMove;
      case 'bare_minimax': return typeof minimax;
      case 'bare_aiMove': return typeof aiMove;
      case 'set_eduMode': return function (v) { eduMode = v; };
      case 'set_showHint': return function (v) { showHint = v; };
      default: return undefined;
    }
  }
};
`;
let pageError = null;
try {
  vm.runInContext(pageCode + PROBE, context, { filename: 'gomoku.html:inline' });
} catch (e) {
  pageError = e;
}
ok('页面内联脚本执行无异常', !pageError, pageError ? pageError.message : '');

/* 如果页面脚本抛错，后续断言全部无意义 */
if (pageError) {
  console.log('\n==== 页面运行时验证 ====');
  for (const r of results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}${r.extra ? '  → ' + r.extra : ''}`);
  console.log('\n页面脚本执行失败，完整错误:\n' + (pageError.stack || pageError.message));
  process.exit(1);
}

/* 词法作用域读取器（每次调用都取当前值，不做快照） */
const probe = sandbox.__probe.get;
const G = new Proxy({}, {
  get(t, k) {
    if (k === 'AI') return sandbox.GomokuAI;
    /* gameMode / currentPlayer 这类是顶层 let，不在全局对象上，
     * 必须走探针读词法作用域；写成 sandbox.gameMode 会得到 undefined。 */
    return probe(k);
  },
  set(t, k, v) {
    if (k === 'eduMode') probe('set_eduMode')(v);
    else if (k === 'showHint') probe('set_showHint')(v);
    return true;
  },
});
const AI = sandbox.GomokuAI;

/* 页面上的动作仍通过词法作用域执行（用 runInContext 调用页面函数） */
const call = (expr) => vm.runInContext(expr, context, { filename: 'probe' });

ok('引擎模块已加载并可用', G.AI_isObject === true && G.AI_getBestMove === true);
/* 拆分收益：引擎函数不再内联在页面里；aiMove 是页面自己的入口函数，应当保留 */
ok('引擎函数不再泄漏到页面全局', G.bare_getBestMove === 'undefined' && G.bare_minimax === 'undefined' && G.bare_aiMove === 'function');
ok('初始为双人模式', G.gameMode === 'pvp');
ok('引擎棋盘尺寸 19', AI.boardSize === 19);
ok('棋盘已注册到引擎', Array.isArray(AI.board) && AI.board.length === 19);

/* 切人机 → init 会调用 AI.setBoardSize / AI.setColors */
call('init(MODE_PVE, false)');
ok('切人机 gameMode=pve', G.gameMode === 'pve');
ok('引擎尺寸仍 19', AI.boardSize === 19);
ok('玩家执黑', AI.playerColor === 1);
ok('AI 执白', AI.aiColor === 2);
ok('棋盘为空', AI.board.flat().filter(v => v !== 0).length === 0);

/* 落子 */
call('placeStone(9, 9)');
ok('落子写入引擎棋盘', AI.board[9][9] === 1);
ok('落子后轮到 AI', G.currentPlayer === AI.aiColor);

/* 同步触发 AI 应手：引擎是纯同步的，直接算一步并落子，避免等定时器 */
const t0 = Date.now();
const aiMoveResult = AI.getBestMove('medium');
const aiMs = Date.now() - t0;
if (aiMoveResult) call(`placeStone(${aiMoveResult[0]}, ${aiMoveResult[1]})`);
const stoneCount = AI.board.flat().filter(v => v !== 0).length;
ok('AI 已应手（≥2 子）', stoneCount >= 2, `棋子 ${stoneCount}，思考 ${aiMs}ms`);
ok('AI 落子后回合回到玩家', G.currentPlayer === AI.playerColor);

/* 教学推荐点（走引擎 medium 搜索） */
G.eduMode = true;
G.showHint = true;
let hintErr = null;
try { call('refreshHint()'); } catch (e) { hintErr = e; }
ok('refreshHint 不抛错', !hintErr, hintErr ? hintErr.message : '');
ok('推荐点合法或为空', G.hintMove === null || Array.isArray(G.hintMove), JSON.stringify(G.hintMove));

/* 胜率估算（走引擎） */
let rateErr = null, rate = null;
try { rate = call('estimateWinRate(AI.playerColor)'); } catch (e) { rateErr = e; }
ok('estimateWinRate 不抛错', !rateErr, rateErr ? rateErr.message : '');
ok('胜率在 0~100', rate && rate.player >= 0 && rate.player <= 100 && rate.ai >= 0 && rate.ai <= 100, JSON.stringify(rate));

/* 悔棋（人机模式撤两手） */
call('undo()');
ok('悔棋后棋盘清空', AI.board.flat().filter(v => v !== 0).length === 0);

/* 换 13 路 */
call('document.getElementById("boardSizeSelect").value = "13"; init(MODE_PVE, false)');
ok('换格后引擎尺寸 13', AI.boardSize === 13);
ok('换格后页面尺寸同步', G.boardSize === 13);

/* 回 19 路 + 双人交替落子 */
call('document.getElementById("boardSizeSelect").value = "19"; init(MODE_PVP, false)');
ok('回双人模式', G.gameMode === 'pvp');
call('placeStone(3, 3); placeStone(4, 4)');
ok('双人交替落子正常', AI.board[3][3] === 1 && AI.board[4][4] === 2);

/* 判胜路径 */
call('init(MODE_PVP, false)');
call('for (let i = 0; i < 5; i++) { placeStone(10, 5 + i); placeStone(11, 5 + i); }');
ok('五连判胜生效', G.gameOver === true && Array.isArray(G.winLine));

console.log('\n==== 页面运行时验证（vm + DOM 桩）====');
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}${r.extra ? '  → ' + r.extra : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} 通过`);
process.exit(failed ? 1 : 0);
