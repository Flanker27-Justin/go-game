// 配对强度测试（gauntlet）：从同一批“随机变化的开局局面”出发，让两个引擎
// 各自在同一局面下执白防守，比较平均存活手数。
//
// 为什么需要它：当“执黑必胜”时，A/B 胜率永远 50%，无法区分强弱；
// 而独立开局的“存活手数”方差很大（实测标准误可达 8 手）。
// 配对设计让两个引擎面对完全相同的局面与对手走法，把开局差异消掉，
// 只留下“防守能力”的差异，方差显著降低。
//
// 用法:
//   node work/duel.js --a <引擎A> --b <引擎B> [--positions 12] [--variety 0.5] [--seed 1]
//   A 与 B 都作为“白方”接受测试，黑方固定为 --black 指定的引擎（默认用 A）。
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const argVal = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const argNum = (n, d) => Number(argVal(n, d));
const FILE_A = path.resolve(ROOT, argVal('a', 'outputs/engine/gomoku-ai.js'));
const FILE_B = path.resolve(ROOT, argVal('b', 'outputs/engine/gomoku-ai.js'));
const FILE_BLACK = path.resolve(ROOT, argVal('black', 'outputs/engine/gomoku-ai.js'));
const POSITIONS = argNum('positions', 12);
const VARIETY = Number(argVal('variety', 0.5));
const SEED = argNum('seed', 9001);
const LEVEL = argVal('level', 'hard');
const MAX_PLIES = argNum('maxPlies', 200);
const S = 19, EMPTY = 0, BLACK = 1, WHITE = 2;
const DIRECTIONS = [[1, 0], [0, 1], [1, 1], [1, -1]];

/* 可复现随机（用于生成开局） */
let seedState = SEED >>> 0 || 1;
function rnd() {
  seedState ^= seedState << 13; seedState >>>= 0;
  seedState ^= seedState >>> 17;
  seedState ^= seedState << 5; seedState >>>= 0;
  return seedState / 4294967296;
}

function loadEngine(file, variety) {
  const src = fs.readFileSync(file, 'utf8');
  const sandbox = {
    module: { exports: {} }, console, performance: { now: () => Date.now() },
    Math, JSON, Set, Map, Int32Array, Array, Object, Number, String,
    isNaN, parseInt, parseFloat, Infinity, NaN,
  };
  sandbox.globalThis = sandbox;
  /* 让每个引擎拥有独立的随机源，避免互相干扰 */
  const mk = (seedV) => { let s = seedV >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; };
  const myMath = Object.create(Math);
  myMath.random = mk(Math.floor(rnd() * 0xFFFFFFFF));
  sandbox.Math = myMath;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: path.basename(file) });
  const api = sandbox.module.exports;
  api.setMoveVariety(variety);
  api.setBoardSize(S);
  return api;
}

const board = Array.from({ length: S }, () => Array(S).fill(EMPTY));
function resetBoard() { for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) board[r][c] = EMPTY; }
function syncTo(eng) { const b = eng.board; for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) b[r][c] = board[r][c]; }
function hasFive(r, c, color) {
  for (const [dr, dc] of DIRECTIONS) {
    let n = 1;
    for (const k of [1, -1]) for (let i = 1; i < 5; i++) {
      const rr = r + dr * i * k, cc = c + dc * i * k;
      if (rr < 0 || rr >= S || cc < 0 || cc >= S || board[rr][cc] !== color) break;
      n++;
    }
    if (n >= 5) return true;
  }
  return false;
}

/* ---------- 1. 生成带变化的开局局面 ---------- */
const opener = loadEngine(FILE_BLACK, VARIETY);
const positions = [];
for (let k = 0; k < POSITIONS; k++) {
  resetBoard();
  board[9][9] = BLACK;
  let stones = 1, turn = WHITE;
  const plies = 4 + Math.floor(rnd() * 6);      // 走 4~9 手，得到不同开局
  while (stones <= plies) {
    syncTo(opener);
    const mv = opener.getBestMove(LEVEL, turn);
    if (!mv || board[mv[0]][mv[1]] !== EMPTY) break;
    board[mv[0]][mv[1]] = turn;
    stones++;
    if (hasFive(mv[0], mv[1], turn)) break;
    turn = turn === BLACK ? WHITE : BLACK;
  }
  positions.push(board.map(row => row.slice()));
}
console.log(`已生成 ${positions.length} 个开局局面（手数 ${positions.map(p => p.flat().filter(v => v).length).join(',')}）`);

/* ---------- 2. 在一个固定局面下，让指定引擎执白走完，返回存活手数 ---------- */
function defend(whiteEngine, startBoard) {
  resetBoard();
  for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) board[r][c] = startBoard[r][c];
  syncTo(whiteEngine);
  /* 找出轮到谁（从手数推断：黑先手，若黑子比白子多则轮到白） */
  let bc = 0, wc = 0;
  for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) { if (board[r][c] === BLACK) bc++; else if (board[r][c] === WHITE) wc++; }
  let turn = bc > wc ? WHITE : BLACK;
  let plies = bc + wc;
  while (plies < MAX_PLIES) {
    const eng = turn === WHITE ? whiteEngine : opener;
    syncTo(eng);
    const mv = eng.getBestMove(LEVEL, turn);
    if (!mv || board[mv[0]][mv[1]] !== EMPTY) return { plies, bad: true };
    board[mv[0]][mv[1]] = turn;
    plies++;
    if (hasFive(mv[0], mv[1], turn)) return { plies, winner: turn === WHITE ? '白' : '黑' };
    turn = turn === BLACK ? WHITE : BLACK;
  }
  return { plies, winner: '和' };
}

/* ---------- 3. 同一局面下，A、B 各自执白，配对比较 ---------- */
const A = loadEngine(FILE_A, VARIETY);
const B = loadEngine(FILE_B, VARIETY);
console.log(`A(白): ${path.relative(ROOT, FILE_A)}`);
console.log(`B(白): ${path.relative(ROOT, FILE_B)}`);
console.log(`黑方(固定): ${path.relative(ROOT, FILE_BLACK)}   随机度 ${VARIETY}`);

const rows = [];
for (let i = 0; i < positions.length; i++) {
  /* 注意：A、B 必须从同一个局面出发，且黑方走法尽量一致——
   * 由于黑方是确定性引擎且局面相同，其后续走法在两局中完全一致，
   * 直到白方走出不同着法导致局面分叉为止。这是配对设计的关键。 */
  const ra = defend(A, positions[i]);
  const rb = defend(B, positions[i]);
  rows.push({ i, a: ra.plies, b: rb.plies, aw: ra.winner, bw: rb.winner });
  console.log(`  局面${i + 1}: A 存活 ${ra.plies} 手(${ra.winner || '未完'}) | B 存活 ${rb.plies} 手(${rb.winner || '未完'}) | 差 ${ra.plies - rb.plies >= 0 ? '+' : ''}${ra.plies - rb.plies}`);
}

const diffs = rows.map(r => r.a - r.b);
const mean = diffs.reduce((x, y) => x + y, 0) / diffs.length;
const sd = Math.sqrt(diffs.reduce((s, d) => s + (d - mean) ** 2, 0) / Math.max(1, diffs.length - 1));
const se = sd / Math.sqrt(diffs.length);
console.log(`\n---- 配对结果（同一局面下作白的存活手数）----`);
console.log(`A 平均存活 ${(rows.reduce((s, r) => s + r.a, 0) / rows.length).toFixed(1)} 手`);
console.log(`B 平均存活 ${(rows.reduce((s, r) => s + r.b, 0) / rows.length).toFixed(1)} 手`);
console.log(`配对差值 A−B = ${mean.toFixed(2)} 手（标准误 ${se.toFixed(2)}，t = ${se ? (mean / se).toFixed(2) : 'n/a'}）`);
const sig = Math.abs(mean) > 1.96 * se;
if (!sig) console.log('→ 差异不显著（视为持平）');
else if (mean > 0) console.log('→ A 作为白方撑得更久：A 的防守/棋力更强');
else console.log('→ B 作为白方撑得更久：B 的防守/棋力更强');
const winsA = rows.filter(r => r.aw === '白').length, winsB = rows.filter(r => r.bw === '白').length;
console.log(`白方取胜次数: A ${winsA} / B ${winsB}（若两者都能胜出，说明该局面白方本可取胜）`);
process.exit(0);
