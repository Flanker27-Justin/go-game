// 定点诊断：直接检查 boardSize 同步、bare 引擎函数泄漏、五连判胜三项。
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'outputs', 'gomoku.html'), 'utf8');
const code = /<script>([\s\S]*?)<\/script>/.exec(html)[1];

function el(id) {
  const store = { id, style: {}, classList: { toggle() { }, add() { }, remove() { } }, dataset: {}, textContent: '', checked: false, value: id === 'boardSizeSelect' ? '19' : '', addEventListener() { } };
  const ctx2d = { canvas: store, beginPath() { }, arc() { }, fill() { }, stroke() { }, moveTo() { }, lineTo() { }, fillRect() { }, fillText() { }, measureText: () => ({ width: 10 }) };
  return new Proxy(store, {
    get(t, k) {
      if (k in store) return store[k];
      if (k === 'getContext') return () => ctx2d;
      if (k === 'getBoundingClientRect') return () => ({ left: 0, top: 0 });
      if (k === 'querySelectorAll') return () => [];
      if (k === 'appendChild' || k === 'append' || k === 'insertBefore' || k === 'removeChild') return (x) => x;
      if (k === 'addEventListener' || k === 'removeEventListener' || k === 'click' || k === 'focus' || k === 'blur' || k === 'remove' || k === 'setAttribute') return () => { };
      return el(id + '.' + String(k));
    },
    set(t, k, v) { store[k] = v; return true; },
    has() { return true; },
  });
}
const doc = {
  getElementById: (id) => el(id),
  querySelector: () => el('q'),
  querySelectorAll: () => [],
  createElement: () => el('new'),
  addEventListener() { },
  body: el('body'),
  documentElement: el('html'),
  activeElement: null,
};
const sandbox = {
  document: doc, console,
  setTimeout: () => 0, clearTimeout: () => { }, setInterval: () => 0, clearInterval: () => { },
  requestAnimationFrame: () => 0, cancelAnimationFrame: () => { },
  location: { protocol: 'http:', host: 'x', search: '', href: 'http://x/' },
  sessionStorage: { getItem: () => null, setItem() { }, removeItem() { } },
  localStorage: { getItem: () => null, setItem() { }, removeItem() { } },
  performance: { now: () => Date.now() },
  URLSearchParams,
  navigator: { userAgent: 'node', clipboard: { writeText: async () => { } }, mediaDevices: { getUserMedia: async () => ({}) } },
  WebSocket: function () { return { readyState: 3, send() { }, close() { } }; },
  RTCPeerConnection: function () { return { close() { }, addIceCandidate() { }, createOffer: async () => ({ sdp: '' }) }; },
  btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  atob: (s) => Buffer.from(s, 'base64').toString('binary'),
};
sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.self = sandbox;
const ctx = vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'outputs', 'engine', 'gomoku-ai.js'), 'utf8'), ctx);

const PROBE = `
;globalThis.__q = {
  get gameMode() { return gameMode; },
  get boardSize() { return boardSize; },
  get aiLevel() { return aiLevel; },
  get gameOver() { return gameOver; },
  get winLine() { return winLine; },
  get currentPlayer() { return currentPlayer; },
  get moveCount() { return moveCount; },
  bare: function (n) { try { return eval('typeof ' + n); } catch (e) { return 'ERR:' + e.message; } }
};
`;
vm.runInContext(code + PROBE, ctx);
const q = sandbox.__q;
const run = (expr) => vm.runInContext(expr, ctx);

console.log('初始      : gameMode=%s boardSize=%s', q.gameMode, q.boardSize);
console.log('  bare 检查: getBestMove=%s minimax=%s aiMove=%s', q.bare('getBestMove'), q.bare('minimax'), q.bare('aiMove'));

run('init(MODE_PVE, false)');
console.log('人机      : gameMode=%s boardSize=%s AI.boardSize=%s', q.gameMode, q.boardSize, sandbox.GomokuAI.boardSize);

run('document.getElementById("boardSizeSelect").value = "13"; init(MODE_PVE, false)');
console.log('切13路    : gameMode=%s boardSize=%s AI.boardSize=%s canvas.width=%s', q.gameMode, q.boardSize, sandbox.GomokuAI.boardSize, run('canvas.width'));

run('document.getElementById("boardSizeSelect").value = "19"; init(MODE_PVP, false)');
console.log('切回19    : gameMode=%s boardSize=%s', q.gameMode, q.boardSize);

run('for (let i = 0; i < 5; i++) { placeStone(10, 5 + i); placeStone(11, 5 + i); }');
console.log('下五连    : gameOver=%s winLine=%s moveCount=%s', q.gameOver, JSON.stringify(q.winLine), q.moveCount);
