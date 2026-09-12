// 测试辅助：给测试提供一个统一的 A 命名空间。
//   · 引擎能力（getBestMove / threatLevel / evaluateBoard …）来自 outputs/engine/gomoku-ai.js
//   · 页面侧教学能力（analyzePoint / estimateWinRate / analyzePlayerMove …）仍内联在
//     outputs/gomoku.html 里（它们属于 UI 层，不属于引擎），此处按函数名从 HTML 提取，
//     并把其中的裸引擎调用（findImmediateWin / threatLevel …）改写为 AI.*。
//
// 这样做的好处：引擎被真正 require（重构 HTML 不会让引擎测试失效），
// 教学逻辑也能继续被断言覆盖，而不需要把它们硬塞进引擎模块。
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const HTML = path.join(ROOT, 'outputs', 'gomoku.html');
const AI = require(path.join(ROOT, 'outputs', 'engine', 'gomoku-ai.js'));
const src = fs.readFileSync(HTML, 'utf8');

/** 按函数名从 HTML 抽取完整函数体（花括号配平） */
function extractFn(name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('在 gomoku.html 中未找到页面函数 ' + name);
  const brace = src.indexOf('{', src.indexOf(')', start));
  let depth = 0, i = brace;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(start, i + 1);
}

/* 页面侧（教学/文案）函数：保留在 HTML 里的那些 */
const PAGE_FNS = [
  'colorName', 'colToLabel', 'formatPos',
  'analyzePoint', 'patternText',
  'analyzePlayerMove', 'playerDoubleThreatComment', 'weakMoveReason', 'eduRecommendLevel',
  'classifyAiMove', 'commentOnAiMove', 'analyzeOpponentIntent', 'estimateWinRate',
];
/* 页面函数里对引擎的裸调用 → AI.*（引擎已不在页面作用域内） */
const ENGINE_NAMES = ['inBoard', 'findImmediateWin', 'threatLevel', 'countThreats', 'canWinNow', 'evaluateBoard',
  'evaluateCell', 'lineInfo', 'lineScore', 'scoreFor', 'getBestMove', 'findVcfWin', 'findVctWin',
  'findDoubleThreat', 'findDoubleKill', 'findOpponentDoubleThreat', 'resolveThreats', 'getCandidateMoves',
  'bookMove', 'openingMove', 'searchDepth', 'pickVaried', 'pickTopN', 'comboBonus', 'threatSpaceBonus'];

let pageCode = PAGE_FNS.map(extractFn).join('\n\n');
for (const fn of ENGINE_NAMES) {
  pageCode = pageCode.replace(new RegExp('(?<![\\w.$\'"`])' + fn + '\\s*\\(', 'g'), 'AI.' + fn + '(');
}

/* 页面侧状态/常量：教学函数会用到，注入到提取出来的代码作用域里 */
const PAGE_STATE = `
const { EMPTY, BLACK, WHITE, DIRECTIONS, LEVEL_EASY, LEVEL_MEDIUM, LEVEL_HARD } = AI;
const WIN_RATE_SCALE = 40000;          // 与页面 estimateWinRate 保持一致
const WIN_RATE_COMBO_WEIGHT = 0.25;
let aiLevel = LEVEL_MEDIUM;
let playerColor = BLACK;
let aiColor = WHITE;
let boardSize = AI.boardSize;          // 页面侧镜像变量（教学函数会读）
let eduMode = false;
let showHint = true;
`;

const factory = new Function('AI', `
'use strict';
${PAGE_STATE}
${pageCode}
return { ${PAGE_FNS.join(', ')} };
`);

const pageFns = factory(AI);
/* 记忆玩家/AI 颜色：教学函数按颜色判断视角，测试里可能切换 */
let playerColor = AI.BLACK;
let aiColor = AI.WHITE;

/* 统一对外对象：先查引擎，再查页面侧函数 */
const A = new Proxy({}, {
  get(t, k) {
    if (k === 'setColors') { return (me, opp) => { playerColor = me; aiColor = opp; AI.setColors(me, opp); }; }
    if (k === 'setMoveVariety') return (v) => AI.setMoveVariety(v);
    if (k === 'lastVcfPath') return AI.lastVcfPath;
    if (k === 'lastVctPath') return AI.lastVctPath;
    if (k === 'board') return AI.board;
    if (k === 'boardSize') return AI.boardSize;
    if (k === 'playerColor') return playerColor;
    if (k === 'aiColor') return aiColor;
    if (k in AI) return AI[k];
    if (k in pageFns) return pageFns[k];
    return undefined;
  },
  has(t, k) {
    return (k in AI) || (k in pageFns) ||
      ['board', 'boardSize', 'playerColor', 'aiColor', 'lastVcfPath', 'lastVctPath', 'setColors', 'setMoveVariety'].includes(k);
  },
  set(t, k, v) {
    if (k === 'playerColor') { playerColor = v; AI.setColors(v, aiColor); return true; }
    if (k === 'aiColor') { aiColor = v; AI.setColors(playerColor, v); return true; }
    return true;
  },
});

module.exports = { A, AI, pageFns, extractFn };
