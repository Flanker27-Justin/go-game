// 生成实验候选：给“阶梯”加一条“主动权”启发——在未被威胁时，
// 优先选择能同时与己方多线呼应的点（而不是仅仅堵对方或贴子）。
// 目的：验证“白方前段过于被动”是否是可改的瓶颈。
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'outputs', 'engine', 'gomoku-ai.js');
const OUT = path.join(ROOT, 'work', 'archive', '_engine-active.js');

let src = fs.readFileSync(SRC, 'utf8');

/* 在 resolveThreats 的“自己活三”之后、返回 null 之前，插入主动发展逻辑：
 * 若以上都不适用（未被威胁、也无现成活三可做），则在本层之外仍保持原样——
 * 真正的改动放在 getBestMove：安静局面下先用“多线呼应”选点，再交给搜索。 */
const ANCHOR = `  const threat = resolveThreats(me, opp, false, false);
    if (threat) return threat;`;
if (!src.includes(ANCHOR)) throw new Error('找不到 resolveThreats 调用锚点（需确认阶梯代码未变）');

const INJECT = `  const threat = resolveThreats(me, opp, false, false);
    if (threat) return threat;
    /* 实验：安静局面先尝试“主动结构”选点——要求一手落子同时与两条以上己方连线呼应，
     * 或形成活三以上威胁；若无此类点则回落到搜索。*/
    {
      const active = activeStructureMove(me, opp);
      if (active) return active;
    }`;
src = src.replace(ANCHOR, INJECT);

/* 新增 activeStructureMove：挑“能同时发展两条线”的点 */
const FN_ANCHOR = 'function getBestMove(level, forColor) {';
if (!src.includes(FN_ANCHOR)) throw new Error('找不到 getBestMove');
src = src.replace(FN_ANCHOR, `/**
 * 主动结构选点（实验）：在未被威胁的安静局面下，优先选择
 * “一手能同时与两条以上己方线呼应（形成活二/活三）”的点，
 * 目的是让落后一方也能主动积累攻势，而不是只做单点防守。
 * 仅当候选点足够强（至少两个方向形成活二以上）时才返回，否则返回 null 交给搜索。
 */
function activeStructureMove(me, opp) {
  const placed = (() => { let n = 0; for (let r = 0; r < boardSize; r++) for (let c = 0; c < boardSize; c++) if (board[r][c] !== EMPTY) n++; return n; })();
  if (placed > 24) return null;                 // 仅用于开局/前中段
  let best = null, bestScore = -Infinity;
  for (let r = 0; r < boardSize; r++) {
    for (let c = 0; c < boardSize; c++) {
      if (board[r][c] !== EMPTY) continue;
      let lines2 = 0, lines1 = 0;
      for (const [dr, dc] of DIRECTIONS) {
        const info = lineInfo(r, c, dr, dc, me);
        if (info.count >= 3 && info.open >= 1) lines2++;      // 成活三
        else if (info.count >= 2 && info.open >= 1) lines1++;  // 成活二
      }
      if (lines2 === 0 && lines1 < 2) continue;    // 至少要“两个方向成二”才算主动结构
      const s = lines2 * 10000 + lines1 * 1000 + scoreFor(r, c, me, opp) * 0.1;
      if (s > bestScore) { bestScore = s; best = [r, c]; }
    }
  }
  return best;
}

` + FN_ANCHOR);

const problems = [];
if (!src.includes('function activeStructureMove(')) problems.push('未注入 activeStructureMove');
try { new (require('vm').Script)(src, { filename: 'cand.js' }); } catch (e) { problems.push('语法错误: ' + e.message); }
if (problems.length) { for (const p of problems) console.log('!! ' + p); process.exit(1); }
fs.writeFileSync(OUT, src, 'utf8');
console.log('已生成实验候选: ' + path.relative(ROOT, OUT));
