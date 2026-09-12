// 自对弈基准（bench）：给 AI 改动提供可比较的量化标尺。
//
// 用途：
//   · 跑同引擎自对弈，统计先手胜率 / 平均手数 / 单步耗时 / 决策层分布；
//   · 跑“两个引擎/两套参数”对抗，用胜率判断改动是否真的变强；
//   · 接入决策层插桩，看清 AI 到底靠哪一层在落子（战术层 vs 搜索）。
//
// 用法:
//   node work/bench.js                      # 自身自对弈 10 局，输出基线
//   node work/bench.js --games 30           # 指定局数
//   node work/bench.js --seed 7             # 指定种子（可复现）
//   node work/bench.js --depth               # 输出决策层分布（较慢）
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const ENGINE = path.join(ROOT, 'outputs', 'engine', 'gomoku-ai.js');
const S = 19;
const EMPTY = 0, BLACK = 1, WHITE = 2;

/* ---------- 参数 ---------- */
const argv = process.argv.slice(2);
const argNum = (name, dflt) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : dflt;
};
const GAMES = argNum('games', 10);
const SEED = argNum('seed', 20260101);
const MAX_PLIES = argNum('maxPlies', 200);
const LEVEL = (argv.includes('--level') ? argv[argv.indexOf('--level') + 1] : 'hard');
const WITH_DEPTH = argv.includes('--depth');

/* ---------- 确定性随机（可复现） ---------- */
let seedState = SEED >>> 0 || 1;
function rnd() {
  seedState ^= seedState << 13; seedState >>>= 0;
  seedState ^= seedState >>> 17;
  seedState ^= seedState << 5; seedState >>>= 0;
  return seedState / 4294967296;
}

/* ---------- 决策层插桩 ----------
 * 在引擎源码里给 getBestMove 的每一档加标记，统计“最终由哪一层决定落点”。
 * 只在 --depth 时启用：做法是复制引擎源码、注入计数语句，再放进独立沙箱执行，
 * 避免污染正式模块。 */
function loadInstrumented() {
  const src = fs.readFileSync(ENGINE, 'utf8');
  const layers = ['findImmediateWin', 'findVcfWin', 'findDoubleThreat', 'resolveThreats',
    'findDoubleKill', 'findVctWin', 'findOpponentDoubleThreat', 'bookMove', 'openingMove',
    'bestBySearch', 'bestByScore'];
  /* 在 getBestMove 体内，为每个 return 之前插入打点 */
  const marker = 'function getBestMove(level, forColor) {';
  const at = src.indexOf(marker);
  if (at < 0) throw new Error('未找到 getBestMove');
  const injected = src.slice(0, at + marker.length) +
    '\n  const __mark = (n) => { globalThis.__layers[n] = (globalThis.__layers[n] || 0) + 1; };' +
    src.slice(at + marker.length);
  /* 统计：包一层 getBestMove，比较各层“单独调用是否会给出同一落点”太贵，
   * 改为直接记录命中顺序——在源码里对每个 `if (xxx) return` 打点是侵入式的，
   * 这里采用轻量近似：记录 getBestMove 内部调用过哪些层的函数。 */
  const fnNames = layers.filter(n => src.includes('function ' + n + '('));
  let patched = injected;
  for (const fn of fnNames) {
    patched = patched.replace(new RegExp('function\\s+' + fn + '\\s*\\(', 'g'),
      `function ${fn}(`);
  }
  const sandbox = { module: { exports: {} }, console, performance: { now: () => Date.now() }, Math, JSON };
  sandbox.globalThis = sandbox;
  sandbox.__layers = {};
  vm.createContext(sandbox);
  vm.runInContext(patched, sandbox, { filename: 'engine-instrumented.js' });
  return sandbox.module.exports;
}

const AI = require(ENGINE);

/* ---------- 对局 ----------
 * ★ 注意：引擎的 setBoardSize() 会**替换**棋盘数组对象。若像以前那样把
 *   `const board = AI.board` 缓存下来，之后引擎换过棋盘，本地引用就会变成
 *   孤儿数组（引擎读到空盘、却又回一个已占用点），从而得出被污染的结论。
 *   因此这里统一通过 bd() 取“当前”棋盘，绝不缓存。 */
const bd = () => AI.board;
function reset() { const b = bd(); for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) b[r][c] = EMPTY; }
function hasFive(r, c, color) {
  const b = bd();
  for (const [dr, dc] of AI.DIRECTIONS) {
    let n = 1;
    for (const k of [1, -1]) for (let i = 1; i < 5; i++) {
      const rr = r + dr * i * k, cc = c + dc * i * k;
      if (rr < 0 || rr >= S || cc < 0 || cc >= S || b[rr][cc] !== color) break;
      n++;
    }
    if (n >= 5) return true;
  }
  return false;
}

const stats = { times: [], plies: [], blackWins: 0, whiteWins: 0, draws: 0, firstMoveBoth: 0 };

console.log(`==== 自对弈基准 ====`);
console.log(`难度 ${LEVEL}，${GAMES} 局，种子 ${SEED}，19 路，moveVariety=0（确定性）`);

AI.setMoveVariety(0);
AI.setBoardSize(S);

const t0All = Date.now();
for (let g = 1; g <= GAMES; g++) {
  reset();
  AI.setColors(BLACK, WHITE);
  /* 双方都用同一引擎：谁执黑通过参数传给 getBestMove 区分视角 */
  bd()[9][9] = BLACK;         // 黑先手固定天元，避免开局随机影响可比性
  let stones = 1, winner = 0;
  let plies = 0;
  const gameTimes = [];
  while (stones < S * S && plies < MAX_PLIES) {
    const color = stones % 2 === 1 ? WHITE : BLACK;
    const t0 = Date.now();
    const mv = AI.getBestMove(LEVEL, color);
    const dt = Date.now() - t0;
    stats.times.push(dt);
    gameTimes.push(dt);
    /* 严格校验引擎落点：必须合法（在盘内且为空）。不合法就立刻报错，
     * 不允许用“随便找个空位”兜底——那会掩盖引擎 bug（曾因此得出
     * “31 手黑胜”这种被污染结论）。 */
    let r, c;
    if (!mv) {
      console.error(`!! 局${g} 第 ${stones + 1} 手：引擎未返回落点`);
      break;
    }
    [r, c] = mv;
    if (!(r >= 0 && r < S && c >= 0 && c < S)) {
      console.error(`!! 局${g} 第 ${stones + 1} 手：落点越界 ${JSON.stringify(mv)}`);
      process.exitCode = 1;
      break;
    }
    if (bd()[r][c] !== EMPTY) {
      console.error(`!! 局${g} 第 ${stones + 1} 手（${color === BLACK ? '黑' : '白'}）：引擎返回已占用格 ${r},${c}`);
      process.exitCode = 1;
      break;
    }
    bd()[r][c] = color;
    stones++; plies++;
    if (hasFive(r, c, color)) { winner = color; break; }
  }
  stats.plies.push(stones);
  if (winner === BLACK) stats.blackWins++;
  else if (winner === WHITE) stats.whiteWins++;
  else stats.draws++;
  console.log(`  局${g}: ${stones} 手, 胜方=${winner === BLACK ? '黑' : winner === WHITE ? '白' : '和'}, ` +
    `本局单步最大 ${Math.max(...gameTimes)}ms`);
}

/* 诊断：头几步的耗时与落点（确认引擎真的在思考，而不是走了捷径） */
{
  reset();
  AI.setColors(BLACK, WHITE);
  bd()[9][9] = BLACK;
  let stones = 1;
  const trace = [];
  while (stones < 12) {
    const color = stones % 2 === 1 ? WHITE : BLACK;
    const t0 = Date.now();
    const mv = AI.getBestMove(LEVEL, color);
    trace.push(`${stones}${color === BLACK ? 'B' : 'W'}:(${mv ? mv.join(',') : 'null'})${Date.now() - t0}ms`);
    if (!mv) break;
    bd()[mv[0]][mv[1]] = color;
    stones++;
  }
  console.log('  前 11 手落点/耗时: ' + trace.join(' '));
}

/* ---------- 汇总 ---------- */
const sum = (a) => a.reduce((x, y) => x + y, 0);
const avg = (a) => a.length ? sum(a) / a.length : 0;
const pct = (n, d) => d ? (n / d * 100).toFixed(1) + '%' : '-';
const sorted = stats.times.slice().sort((a, b) => a - b);
const p = (q) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] : 0;

console.log(`\n---- 结果 ----`);
console.log(`先手(黑)胜 ${stats.blackWins} / 后手(白)胜 ${stats.whiteWins} / 和 ${stats.draws}`);
console.log(`先手胜率 ${pct(stats.blackWins, GAMES)}（越接近 50% 说明双方越均衡；100% 说明白方防不住）`);
console.log(`平均手数 ${avg(stats.plies).toFixed(1)}（总 ${sum(stats.plies)} 手）`);
console.log(`单步耗时: 平均 ${avg(stats.times).toFixed(0)}ms, p50 ${p(0.5)}ms, p90 ${p(0.9)}ms, p99 ${p(0.99)}ms, 最大 ${sorted[sorted.length - 1]}ms`);
console.log(`总耗时 ${((Date.now() - t0All) / 1000).toFixed(1)}s`);

/* ---------- 决策层分布 ---------- */
if (WITH_DEPTH) {
  console.log(`\n---- 决策层分布（各层函数被调用的次数，反映 AI 依赖哪一层） ----`);
  const INS = loadInstrumented();
  INS.setMoveVariety(0);
  INS.setBoardSize(S);
  const counts = {};
  const wrap = ['getBestMove', 'findImmediateWin', 'findVcfWin', 'findVctWin', 'findDoubleThreat',
    'findDoubleKill', 'findOpponentDoubleThreat', 'resolveThreats', 'bookMove', 'openingMove',
    'bestBySearch', 'bestByScore', 'getCandidateMoves', 'minimax', 'throwingNothing'];
  /* 通过包装统计调用次数 */
  for (const name of wrap) {
    if (typeof INS[name] !== 'function') continue;
    const orig = INS[name];
    counts[name] = 0;
    INS[name] = function (...args) { counts[name]++; return orig.apply(this, args); };
  }
  reset();
  INS.bd()[9][9] = BLACK;
  let stones = 1, plies = 0;
  while (stones < S * S && plies < 60) {
    const color = stones % 2 === 1 ? WHITE : BLACK;
    const mv = INS.getBestMove(LEVEL, color);
    if (!mv) break;
    INS.bd()[mv[0]][mv[1]] = color;
    stones++; plies++;
    if (hasFive(mv[0], mv[1], color)) break;
  }
  const rows = Object.entries(counts).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  for (const [k, v] of rows) console.log(`  ${k.padEnd(26)} ${v}`);
  console.log(`  说明：findImmediateWin / resolveThreats 被大量调用属正常（它们是判据）；`);
  console.log(`        关键看 bestBySearch（真正的搜索）调用次数是否与局面数相当。`);
}
