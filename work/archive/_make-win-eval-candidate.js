// 生成候选引擎：在正式引擎基础上加入“滑动窗口棋型评估”作为可切换的新评估。
// 目的：先用 matchup.js 对照验证新评估是否更强，通过了再并入正式引擎。
// 用法: node work/_make-win-eval-candidate.js
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'outputs', 'engine', 'gomoku-ai.js');
const OUT = path.join(ROOT, 'work', 'archive', '_engine-wineval.js');

let src = fs.readFileSync(SRC, 'utf8');

/* ---------- 1. 新增常量：窗口棋型分值 ---------- */
const CONST_ANCHOR = 'const DIRECTIONS = [[1, 0], [0, 1], [1, 1], [1, -1]];';
if (!src.includes(CONST_ANCHOR)) throw new Error('找不到 DIRECTIONS 锚点');
src = src.replace(CONST_ANCHOR, CONST_ANCHOR + `

/* 滑动窗口棋型分值（新评估用）：按“一条长度 5 的窗口里有多少颗己方子、且无对方子”计分。
 * 这是五子棋标准评估法，天然能识别跳型（X_XX / XX_XX）——旧评估只数连续连子，
 * 实测把跳活三低估到连活三的 45%。
 * 为什么分值这样给：窗口里已有 4 颗己方子时，剩下那 1 格落下即五连，属于“绝杀”，
 * 必须远高于一切活三/活二；3 颗是活三级别威胁；2 颗是活二级别的展开基础。 */
const WSCORE = [0, 1, 12, 240, 60000, 1000000];`);

/* ---------- 2. 新增窗口统计与窗口评估函数 ---------- */
const EVAL_ANCHOR = 'function evaluateBoard(me = aiColor, opp = playerColor, comboWeight = 1, tempoFor = null) {';
if (!src.includes(EVAL_ANCHOR)) throw new Error('找不到 evaluateBoard 锚点');
const NEW_FUNCS = `/**
 * 统计“长度 5 的窗口”棋型：对每个方向、每个连续 5 格窗口，
 * 若窗口里没有对方棋子，就按窗口内己方子数计数。
 * 这一统计天然覆盖跳型（X_XX 与 XX_XX），因为只看窗口内子数、不要求连续。
 * @returns {Int32Array} 下标 0~5，cnt[n] = 含 n 颗己方子且不含对方子的窗口数
 */
function windowCounts(color) {
  const opp = color === BLACK ? WHITE : BLACK;
  const cnt = new Int32Array(6);
  for (let r = 0; r < boardSize; r++) {
    for (let c = 0; c < boardSize; c++) {
      for (let d = 0; d < 4; d++) {
        const dr = DIRECTIONS[d][0], dc = DIRECTIONS[d][1];
        const er = r + dr * 4, ec = c + dc * 4;      // 窗口末端
        if (er < 0 || er >= boardSize || ec < 0 || ec >= boardSize) continue;
        let mine = 0, blocked = false;
        for (let k = 0; k < 5; k++) {
          const v = board[r + dr * k][c + dc * k];
          if (v === color) mine++;
          else if (v === opp) { blocked = true; break; }
        }
        if (!blocked) cnt[mine]++;
      }
    }
  }
  return cnt;
}

/**
 * 滑动窗口版局面评估（新评估，A/B 对照用）。
 * = 己方窗口棋型总分 − 对方窗口棋型总分 × 1.1
 *   + 连接性 / 中心权重 + 双威胁组合分 + 威胁空间分 + 先手权修正
 * 与旧评估的区别只在“棋型分”的计算方式：旧版逐条线数连续连子，
 * 新版按长度 5 的窗口统计，能正确识别跳型与跳四。
 */
function evaluateBoardWindow(me, opp, comboWeight, tempoFor) {
  const cntMe = windowCounts(me);
  const cntOp = windowCounts(opp);
  let aiScore = 0, playerScore = 0;
  for (let n = 1; n <= 5; n++) {
    aiScore += WSCORE[n] * Math.min(cntMe[n], 40);      // 设上限，避免开局窗口数过多淹没其它项
    playerScore += WSCORE[n] * Math.min(cntOp[n], 40);
  }
  /* 连接性与中心权重：与旧评估保持同一量纲，便于公平对照 */
  let aiAdj = 0, playerAdj = 0;
  const center = (boardSize - 1) / 2;
  for (let r = 0; r < boardSize; r++) {
    for (let c = 0; c < boardSize; c++) {
      const color = board[r][c];
      if (color === EMPTY) continue;
      let adj = 0;
      for (const [dr, dc] of DIRECTIONS) {
        const nr = r + dr, nc = c + dc;
        if (inBoard(nr, nc) && board[nr][nc] === color) adj++;
      }
      const posW = boardSize - (Math.abs(r - center) + Math.abs(c - center));
      if (color === me) { aiAdj += adj; aiScore += posW * CENTER_WEIGHT; }
      else { playerAdj += adj; playerScore += posW * CENTER_WEIGHT; }
    }
  }
  aiScore += comboBonus(me) * comboWeight;
  playerScore += comboBonus(opp) * comboWeight;
  const aiSpace = threatSpaceBonus(me) * comboWeight;
  const playerSpace = threatSpaceBonus(opp) * comboWeight;
  const raw = (aiScore + aiAdj * CONNECT_BONUS + aiSpace)
            - (playerScore + playerAdj * CONNECT_BONUS + playerSpace) * 1.1;
  if (tempoFor === me) return raw + TEMPO_BONUS;
  if (tempoFor === opp) return raw - TEMPO_BONUS;
  return raw;
}

`;
src = src.replace(EVAL_ANCHOR, NEW_FUNCS + EVAL_ANCHOR);

/* ---------- 3. 加开关：evaluateBoard 内部按开关分流 ---------- */
const EVAL_BODY_ANCHOR = `  let aiScore = 0;
  let playerScore = 0;
  let aiAdj = 0;
  let playerAdj = 0;`;
if (!src.includes(EVAL_BODY_ANCHOR)) throw new Error('找不到 evaluateBoard 主体锚点');
src = src.replace(EVAL_BODY_ANCHOR,
  `  /* 新评估开关（A/B 对照用；正式版会去掉开关只留新评估，若新评估胜出） */
  if (useWindowEval) return evaluateBoardWindow(me, opp, comboWeight, tempoFor);

  let aiScore = 0;
  let playerScore = 0;
  let aiAdj = 0;
  let playerAdj = 0;`);

/* ---------- 4. 状态变量 + 对外开关 ---------- */
const STATE_ANCHOR = 'let killerTable = null;       // 杀手表';
if (!src.includes(STATE_ANCHOR)) throw new Error('找不到状态锚点');
src = src.replace(STATE_ANCHOR, STATE_ANCHOR + '\nlet useWindowEval = false;    // 是否使用滑动窗口版棋型评估（A/B 对照）');

const API_ANCHOR = '    setMoveVariety(v) { moveVariety = v; },';
if (!src.includes(API_ANCHOR)) throw new Error('找不到 API 锚点');
src = src.replace(API_ANCHOR, API_ANCHOR + '\n    setWindowEval(v) { useWindowEval = !!v; },');

/* ---------- 5. 自检 ---------- */
const problems = [];
if (!src.includes('function evaluateBoardWindow(')) problems.push('未注入新评估函数');
if (!src.includes('function windowCounts(')) problems.push('未注入窗口统计算');
if (!src.includes('setWindowEval')) problems.push('未注入开关');
try { new (require('vm').Script)(src, { filename: 'candidate.js' }); }
catch (e) { problems.push('产物语法错误: ' + e.message); }

if (problems.length) {
  console.log('!! 候选生成失败:');
  for (const p of problems) console.log('  - ' + p);
  process.exit(1);
}
fs.writeFileSync(OUT, src, 'utf8');
console.log('已生成候选引擎: ' + path.relative(ROOT, OUT));
console.log('  含 windowCounts / evaluateBoardWindow / setWindowEval 开关');

/* 冒烟测试：确认开关切换后评估值确实不同 */
const vm = require('vm');
function load(file) {
  const sb = { module: { exports: {} }, console, performance: { now: () => Date.now() }, Math, JSON, Set, Map, Int32Array, Array, Object, Number, String, isNaN, parseInt, parseFloat, Infinity, NaN };
  sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(file, 'utf8'), sb, { filename: file });
  return sb.module.exports;
}
const C = load(OUT);
C.setMoveVariety(0);
C.setBoardSize(19);
C.setColors(1, 2);
const b = C.board;
for (let r = 0; r < 19; r++) for (let c = 0; c < 19; c++) b[r][c] = 0;
b[10][6] = 2; b[10][7] = 2; b[10][8] = 2;      // 白连活三
C.setWindowEval(false);
const oldEv = C.evaluateBoard(2, 1, 1, null);
C.setWindowEval(true);
const newEv = C.evaluateBoard(2, 1, 1, null);
console.log(`  连活三：旧评估=${oldEv}  新评估=${newEv}`);
for (let r = 0; r < 19; r++) for (let c = 0; c < 19; c++) b[r][c] = 0;
b[10][6] = 2; b[10][7] = 2; b[10][9] = 2;      // 白跳活三 X X _ X
C.setWindowEval(false);
const oldEv2 = C.evaluateBoard(2, 1, 1, null);
C.setWindowEval(true);
const newEv2 = C.evaluateBoard(2, 1, 1, null);
console.log(`  跳活三：旧评估=${oldEv2}  新评估=${newEv2}`);
console.log(`  新评估下 跳/连 比值 = ${(newEv2 / newEv).toFixed(3)}（旧评估下为 ${(oldEv2 / oldEv).toFixed(3)}；越接近 1 说明越不低估跳型）`);
