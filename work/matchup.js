// A/B 对弈：把两套引擎代码放进同一个进程对抗，用胜率判断改动是否真的变强。
//
// 用法:
//   node work/matchup.js                        # 自身 vs 自身（基线，应约 50/50 或先手占优）
//   node work/matchup.js --b <另一个引擎文件>    # 当前引擎 vs 指定引擎文件
//   node work/matchup.js --games 20 --seed 7
//
// 说明: 两个引擎各自独立（独立棋盘、独立置换表），共享同一“裁判”棋盘。
//       每局交替执黑，抵消先手优势；输出胜率与 95% 置信区间粗估。
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const ENGINE_A = path.join(ROOT, 'outputs', 'engine', 'gomoku-ai.js');
const argv = process.argv.slice(2);
const argVal = (name, dflt) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const argNum = (name, dflt) => Number(argVal(name, dflt));
const ENGINE_B = path.resolve(ROOT, argVal('b', 'outputs/engine/gomoku-ai.js'));
const GAMES = argNum('games', 20);
const SEED = argNum('seed', 424242);
const LEVEL = argVal('level', 'hard');
/* 出棋随机度：默认 0（完全确定）。注意——当双方都很强时“执黑必胜”，
 * 此时单纯看 A/B 胜率会永远 50%，无法区分强弱（因为谁执黑谁赢）。
 * 因此引入 variety>0 让开局走法有变化，从而产生不同的对局走势与手数。 */
const VARIETY = Number(argVal('variety', 0));
const S = 19;
const EMPTY = 0, BLACK = 1, WHITE = 2;
const DIRECTIONS = [[1, 0], [0, 1], [1, 1], [1, -1]];

/** 在独立沙箱里加载一份引擎（各自独立的棋盘与搜索缓存） */
function loadEngine(file, opts) {
  const src = fs.readFileSync(file, 'utf8');
  const sandbox = { module: { exports: {} }, console, performance: { now: () => Date.now() }, Math, JSON, Set, Map, Int32Array, Array, Object, Number, String, isNaN, parseInt, parseFloat, Infinity, NaN };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: path.basename(file) });
  const api = sandbox.module.exports;
  api.setMoveVariety(opts && opts.variety != null ? opts.variety : 0);
  api.setBoardSize(S);
  /* 可选：启用候选引擎里的“滑动窗口评估”开关（若该引擎提供 setWindowEval） */
  if (opts && opts.windowEval && typeof api.setWindowEval === 'function') api.setWindowEval(true);
  return api;
}

const A = loadEngine(ENGINE_A, { windowEval: argv.includes('--awin'), variety: VARIETY });
const B = loadEngine(ENGINE_B, { windowEval: argv.includes('--bwin'), variety: VARIETY });
const sameEngine = ENGINE_A === ENGINE_B && !argv.includes('--awin') && !argv.includes('--bwin');

console.log('==== 引擎 A/B 对弈 ====');
console.log('A: ' + path.relative(ROOT, ENGINE_A) + (argv.includes('--awin') ? '  [滑动窗口评估]' : '  [原评估]'));
console.log('B: ' + path.relative(ROOT, ENGINE_B) + (argv.includes('--bwin') ? '  [滑动窗口评估]' : '  [原评估]') + (sameEngine ? '  (与 A 相同 → 自洽性检查)' : ''));
console.log(`难度 ${LEVEL}，${GAMES} 局，交替执黑，种子 ${SEED}，出棋随机度 ${VARIETY}`);

/* 裁判棋盘（独立于两侧引擎） */
const judge = Array.from({ length: S }, () => Array(S).fill(EMPTY));
function resetJudge() { for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) judge[r][c] = EMPTY; }
function syncTo(eng) {
  const b = eng.board;
  for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) b[r][c] = judge[r][c];
}
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

let aWins = 0, bWins = 0, draws = 0, dirty = 0;
const aTimes = [], bTimes = [], gameLens = [];
/* 关键指标：当“执黑必胜”时，胜负只反映先手优势，无法区分强弱。
 * 因此额外统计“某一方作白时，棋局能持续多少手”——作白撑得越久说明防守越强。
 * 记录每局的手数与该局白方是谁。 */
const whiteSurvival = { A: [], B: [] };

for (let g = 0; g < GAMES; g++) {
  resetJudge();
  const aIsBlack = g % 2 === 0;
  judge[9][9] = BLACK;
  let stones = 1, winner = null;
  while (stones < S * S && stones < 200) {
    const color = stones % 2 === 1 ? WHITE : BLACK;
    const isA = (color === BLACK) === aIsBlack;
    const eng = isA ? A : B;
    syncTo(eng);
    const t0 = Date.now();
    const mv = eng.getBestMove(LEVEL, color);
    const dt = Date.now() - t0;
    (isA ? aTimes : bTimes).push(dt);
    if (!mv) { dirty++; break; }
    const [r, c] = mv;
    if (!(r >= 0 && r < S && c >= 0 && c < S) || judge[r][c] !== EMPTY) {
      console.error(`!! 局${g + 1} 第 ${stones + 1} 手：${isA ? 'A' : 'B'} 返回非法落点 ${JSON.stringify(mv)}`);
      dirty++;
      break;
    }
    judge[r][c] = color;
    stones++;
    if (hasFive(r, c, color)) { winner = color; break; }
  }
  gameLens.push(stones);
  /* 本局执白者：aIsBlack 为 true 时白方是 B，反之为 A */
  (aIsBlack ? whiteSurvival.B : whiteSurvival.A).push(stones);
  if (!winner) draws++;
  else if ((winner === BLACK) === aIsBlack) aWins++;
  else bWins++;
  console.log(`  局${g + 1}: ${stones} 手, ${winner ? ((winner === BLACK) === aIsBlack ? 'A 胜' : 'B 胜') : '和/'}, 白方=${aIsBlack ? 'B' : 'A'}`);
}

const sum = (a) => a.reduce((x, y) => x + y, 0);
const avg = (a) => a.length ? sum(a) / a.length : 0;
const pct = (n, d) => d ? n / d : 0;
const aRate = pct(aWins, GAMES);
/* 二项分布 95% 置信区间（Wald 近似），用于判断差异是否显著 */
const se = Math.sqrt(aRate * (1 - aRate) / Math.max(1, GAMES));
console.log(`\n---- 结果 ----`);
console.log(`A 胜 ${aWins} / B 胜 ${bWins} / 和 ${draws}${dirty ? ` / 异常 ${dirty}` : ''}`);
console.log(`A 胜率 ${(aRate * 100).toFixed(1)}%  (95% CI ±${(1.96 * se * 100).toFixed(1)}%)`);
console.log(`平均手数 ${avg(gameLens).toFixed(1)}；A 单步平均 ${avg(aTimes).toFixed(0)}ms，B 单步平均 ${avg(bTimes).toFixed(0)}ms`);

/* 核心判据：作白时的平均存活手数（越大越强）。当“执黑必胜”时，胜率无区分度。 */
const survA = whiteSurvival.A, survB = whiteSurvival.B;
if (survA.length && survB.length) {
  const mA = avg(survA), mB = avg(survB);
  const sd = (arr, m) => Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, arr.length - 1));
  const seA = sd(survA, mA) / Math.sqrt(survA.length), seB = sd(survB, mB) / Math.sqrt(survB.length);
  const diff = mA - mB, seDiff = Math.sqrt(seA * seA + seB * seB);
  console.log(`\n---- 作白存活手数（核心判据：执黑必胜时唯一能区分强弱的口径）----`);
  console.log(`A 作白: ${survA.length} 局，平均 ${mA.toFixed(1)} 手  [${survA.join(',')}]`);
  console.log(`B 作白: ${survB.length} 局，平均 ${mB.toFixed(1)} 手  [${survB.join(',')}]`);
  console.log(`差值 A−B = ${diff.toFixed(2)} 手（标准误 ${seDiff.toFixed(2)}）`);
  const significant = Math.abs(diff) > 1.96 * seDiff;
  if (!significant) console.log('→ 存活手数差异不显著（视为持平）');
  else if (diff > 0) console.log('→ A 作白撑得更久，A 的防守更强（A 更优）');
  else console.log('→ B 作白撑得更久，B 的防守更强（B 更优）');
}

if (sameEngine) {
  console.log('（同一引擎自洽性检查：胜率偏离 50% 过多说明先手优势或流程有偏）');
} else if (GAMES < 20) {
  console.log('提示: 局数偏少，建议 --games 30 以上，并配合 --variety 0.3 制造对局变化。');
}
process.exit(dirty ? 1 : 0);
