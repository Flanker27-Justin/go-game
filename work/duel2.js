// 配对强度测试 v2（固定进攻方，多局面）：
// 对每个局面，先用参照引擎走一段开局前缀得到局面，并录制黑方后续进攻序列；
// 然后让 A、B 在该局面下各自执白对抗**同一条**黑方序列，比较存活手数。
// 由于进攻序列完全相同，配对成立，方差显著低于自由对局。
//
// 用法: node work/duel2.js --a <白A> --b <白B> [--positions 10] [--prefix 6|random] [--variety 0.6]
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
const FILE_REF = path.resolve(ROOT, argVal('ref', 'outputs/engine/gomoku-ai.js'));
const POSITIONS = argNum('positions', 10);
const PREFIX_BASE = argNum('prefix', 4);
const VARIETY = Number(argVal('variety', 0.6));
const SEED = argNum('seed', 31337);
const LEVEL = argVal('level', 'hard');
const MAX_PLIES = argNum('maxPlies', 240);
const S = 19, EMPTY = 0, BLACK = 1, WHITE = 2;
const DIRECTIONS = [[1, 0], [0, 1], [1, 1], [1, -1]];

let seedState = SEED >>> 0 || 1;
function rnd() {
  seedState ^= seedState << 13; seedState >>>= 0;
  seedState ^= seedState >>> 17;
  seedState ^= seedState << 5; seedState >>>= 0;
  return seedState / 4294967296;
}
function mkRandom(seedV) {
  let s = seedV >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
function loadEngine(file, variety, randSeed) {
  const src = fs.readFileSync(file, 'utf8');
  const sandbox = {
    module: { exports: {} }, console, performance: { now: () => Date.now() },
    Math, JSON, Set, Map, Int32Array, Array, Object, Number, String,
    isNaN, parseInt, parseFloat, Infinity, NaN,
  };
  sandbox.globalThis = sandbox;
  const myMath = Object.create(Math);
  myMath.random = mkRandom(randSeed);
  sandbox.Math = myMath;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: path.basename(file) });
  const api = sandbox.module.exports;
  api.setMoveVariety(variety);
  api.setBoardSize(S);
  return api;
}

let judge = Array.from({ length: S }, () => Array(S).fill(EMPTY));
function resetJudge() { judge = Array.from({ length: S }, () => Array(S).fill(EMPTY)); }
function syncTo(eng) { const b = eng.board; for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) b[r][c] = judge[r][c]; }
function hasFive(r, c, color) {
  for (const [dr, dc] of DIRECTIONS) {
    let n = 1;
    for (const k of [1, -1]) for (let i = 1; i < 5; i++) {
      const rr = r + dr * i * k, cc = c + dc * i * k;
      if (rr < 0 || rr >= S || cc < 0 || cc >= S || judge[rr][cc] !== color) break;
      n++;
    }
    if (n >= 5) return true;
  }
  return false;
}

const A = loadEngine(FILE_A, VARIETY, Math.floor(rnd() * 0xFFFFFFFF));
const B = loadEngine(FILE_B, VARIETY, Math.floor(rnd() * 0xFFFFFFFF));
console.log(`A(白): ${path.relative(ROOT, FILE_A)}`);
console.log(`B(白): ${path.relative(ROOT, FILE_B)}`);
console.log(`参照/进攻方: ${path.relative(ROOT, FILE_REF)}   随机度 ${VARIETY}   局面数 ${POSITIONS}\n`);

/** 构造第 k 个局面：返回 { startBoard, startTurn, stones, blackScript } */
function buildPosition(k) {
  const ref = loadEngine(FILE_REF, VARIETY, Math.floor(rnd() * 0xFFFFFFFF));
  resetJudge();
  judge[9][9] = BLACK;
  let stones = 1, turn = WHITE;
  const prefix = PREFIX_BASE + Math.floor(rnd() * 5);   // 4~8 手前缀，制造差异
  while (stones <= prefix) {
    syncTo(ref);
    const mv = ref.getBestMove(LEVEL, turn);
    if (!mv || judge[mv[0]][mv[1]] !== EMPTY) break;
    judge[mv[0]][mv[1]] = turn;
    stones++;
    if (hasFive(mv[0], mv[1], turn)) break;
    turn = turn === BLACK ? WHITE : BLACK;
  }
  const startBoard = judge.map(r => r.slice());
  const startTurn = turn;
  /* 录制黑方进攻序列（用参照引擎正常对走） */
  const script = [];
  let localTurn = turn, plies = stones;
  while (plies < MAX_PLIES && script.length < 100) {
    syncTo(ref);
    const mv = ref.getBestMove(LEVEL, localTurn);
    if (!mv || judge[mv[0]][mv[1]] !== EMPTY) break;
    if (localTurn === BLACK) script.push([mv[0], mv[1]]);
    judge[mv[0]][mv[1]] = localTurn;
    plies++;
    if (hasFive(mv[0], mv[1], localTurn)) break;
    localTurn = localTurn === BLACK ? WHITE : BLACK;
  }
  return { startBoard, startTurn, stones, script };
}

function defend(whiteEngine, pos) {
  resetJudge();
  for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) judge[r][c] = pos.startBoard[r][c];
  let turn = pos.startTurn, plies = pos.stones, bi = 0;
  while (plies < MAX_PLIES) {
    let mv;
    if (turn === BLACK) {
      if (bi >= pos.script.length) return { plies, winner: '脚本用尽' };
      mv = pos.script[bi++];
      if (judge[mv[0]][mv[1]] !== EMPTY) return { plies, winner: '白方逼黑脱谱', derailed: true };
    } else {
      syncTo(whiteEngine);
      mv = whiteEngine.getBestMove(LEVEL, WHITE);
      if (!mv || judge[mv[0]][mv[1]] !== EMPTY) return { plies, winner: '异常' };
    }
    judge[mv[0]][mv[1]] = turn;
    plies++;
    if (hasFive(mv[0], mv[1], turn)) return { plies, winner: turn === WHITE ? '白' : '黑' };
    turn = turn === BLACK ? WHITE : BLACK;
  }
  return { plies, winner: '超限' };
}

const diffs = [];
console.log('局面  A存活  B存活   差   A结果 / B结果');
for (let k = 0; k < POSITIONS; k++) {
  const pos = buildPosition(k);
  const ra = defend(A, pos);
  const rb = defend(B, pos);
  const d = ra.plies - rb.plies;
  diffs.push(d);
  console.log(`${String(k + 1).padStart(3)}  ${String(ra.plies).padStart(5)}  ${String(rb.plies).padStart(5)}  ${String(d >= 0 ? '+' + d : d).padStart(4)}   ${ra.winner || '未完'} / ${rb.winner || '未完'}`);
}

const mean = diffs.reduce((x, y) => x + y, 0) / diffs.length;
const sd = Math.sqrt(diffs.reduce((s, d) => s + (d - mean) ** 2, 0) / Math.max(1, diffs.length - 1));
const se = sd / Math.sqrt(diffs.length);
const zero = diffs.filter(d => d === 0).length;
console.log(`\n---- 配对结果 ----`);
console.log(`有效局面 ${diffs.length}（其中 ${zero} 个两引擎表现完全相同）`);
console.log(`配对差值 A−B = ${mean.toFixed(2)} 手（标准差 ${sd.toFixed(2)}，标准误 ${se.toFixed(2)}，t = ${se ? (mean / se).toFixed(2) : 'n/a'}）`);
const sig = Math.abs(mean) > 1.96 * se && Number.isFinite(se) && se > 0;
if (zero === diffs.length) console.log('→ 两引擎行为完全一致（该改动在本批局面下不改变决策）');
else if (!sig) console.log('→ 差异不显著（视为持平）');
else if (mean > 0) console.log('→ A 作白撑得更久：A 更强');
else console.log('→ B 作白撑得更久：B 更强');
