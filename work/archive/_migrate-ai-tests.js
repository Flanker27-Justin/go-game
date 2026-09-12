// 一次性迁移：把两个 AI 测试从“正则抠 HTML 函数 + new Function”改成 require 引擎模块。
// 只替换文件头部到 A = api(...) 为止的加载代码，断言部分一字不动。
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const problems = [];

/** 生成新的加载头：完全兼容旧测试用到的标识符 */
function makeHeader({ withEval }) {
  return `// ============================================================
// 加载方式（2026-xx 迁移）：直接 require 引擎模块，不再从 gomoku.html 正则抠函数。
// 引擎是唯一权威实现：outputs/engine/gomoku-ai.js（由 work/build-engine.js 生成）。
// 好处：重构 HTML 不会让测试失效；改引擎立刻被测到。
// ============================================================
const path = require('path');
const fs = require('fs');
const S = 19;

/* 统一测试入口：引擎能力来自 require 的引擎模块，
 * 页面侧教学能力（analyzePoint / estimateWinRate …）由 harness 从 HTML 提取。 */
const { A, AI } = require(path.join(__dirname, '_test-harness.js'));
const {
  EMPTY, BLACK, WHITE, DIRECTIONS, LEVEL_EASY, LEVEL_MEDIUM, LEVEL_HARD,
} = AI;
const AI_COLOR = A.WHITE;
const LIVE_THREE_SCORE = A.LIVE_THREE_SCORE;
const HINT_RADIUS = A.HINT_RADIUS;
const WIN_SCORE = A.WIN_SCORE;
const PATTERN_TABLE = A.PATTERN_TABLE;
/* 开局库：可读副本，仅供“库内应答必须合法”这类断言参考 */
const OPENING_BOOK = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'outputs', 'engine', 'opening-book.json'), 'utf8'));
/* 以下常量在断言体里被直接引用（原先由 api() 形参注入），现在从引擎取 */
const SEARCH_DEPTH = A.SEARCH_DEPTH;
const CANDIDATE_LIMIT = A.CANDIDATE_LIMIT;
const ROOT_CANDIDATE_LIMIT = A.ROOT_CANDIDATE_LIMIT;
const SEARCH_BUDGET_MS = A.SEARCH_BUDGET_MS;
const MEDIUM_SEARCH_DEPTH = A.MEDIUM_SEARCH_DEPTH;
const MEDIUM_SEARCH_BUDGET_MS = A.MEDIUM_SEARCH_BUDGET_MS;
const VCF_MAX_PLIES = A.VCF_MAX_PLIES;
const VCF_NODE_LIMIT = A.VCF_NODE_LIMIT;
const VCF_TIME_BUDGET_MS = A.VCF_TIME_BUDGET_MS;
const VCT_MAX_PLIES = A.VCT_MAX_PLIES;
const VCT_NODE_LIMIT = A.VCT_NODE_LIMIT;
const VCT_TIME_BUDGET_MS = A.VCT_TIME_BUDGET_MS;
const OPENING_TOTAL_MOVES = A.OPENING_TOTAL_MOVES;
const OPENING_DOUBLE_BONUS = A.OPENING_DOUBLE_BONUS;
const OPENING_BOOK_MAX_STONES = A.OPENING_BOOK_MAX_STONES;
const CONNECT_BONUS = A.CONNECT_BONUS;
const CENTER_WEIGHT = A.CENTER_WEIGHT;
const DOUBLE_THREAT_BONUS = A.DOUBLE_THREAT_BONUS;
const TEMPO_BONUS = A.TEMPO_BONUS;
const TT_MAX_ENTRIES = A.TT_MAX_ENTRIES;
const TT_EXACT = A.TT_EXACT;
const TT_LOWER = A.TT_LOWER;
const TT_UPPER = A.TT_UPPER;
const TT_SIDE_ME = A.TT_SIDE_ME;
const TT_SIDE_OPP = A.TT_SIDE_OPP;
const TT_PERSP_BLACK = A.TT_PERSP_BLACK;
const TT_PERSP_WHITE = A.TT_PERSP_WHITE;

/* 页面侧状态：测试固定 moveVariety=0 关闭随机，保证断言确定 */
const playerColor = BLACK;
const aiColor = WHITE;
A.setColors(playerColor, aiColor);
A.setMoveVariety(0);

/* 棋盘直接复用引擎持有的那一份（put/reset 都写它） */
const board = A.board;
function reset() { for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) board[r][c] = EMPTY; }
function put(color, cells) { for (const [r, c] of cells) board[r][c] = color; }
const inB = (r, c) => r >= 0 && r < S && c >= 0 && c < S;
`;
}

const FILES = [
  { file: 'work/ai-threat-test.js' },
  { file: 'work/ai-scoring-test.js' },
];

for (const { file } of FILES) {
  const abs = path.join(ROOT, file);
  const src = fs.readFileSync(abs, 'utf8');
  const lines = src.split(/\r?\n/);

  /* 找到“加载头结束”的位置：A = api(...) 语句（可能跨行，以 ); 结束） */
  const startIdx = lines.findIndex(l => l.includes("const A = api("));
  if (startIdx < 0) { problems.push(`${file}: 找不到 const A = api(`); continue; }
  let endIdx = startIdx;
  while (endIdx < lines.length && !/\);\s*$/.test(lines[endIdx])) endIdx++;
  if (endIdx >= lines.length) { problems.push(`${file}: A = api(...) 未正常结束`); continue; }

  /* 保留 A 声明之后的空行与其余内容 */
  let rest = lines.slice(endIdx + 1).join('\n');

  /* 场景17 过去用 api() 造第二个实例（moveVariety=1）来测随机化。
   * 引擎现为单例：临时打开随机度，循环结束立刻恢复 0，避免影响后续确定性断言。 */
  if (/const A2 = api\(/.test(rest)) {
    const startA2 = rest.indexOf('const A2 = api(');
    const endA2 = rest.indexOf(');', startA2);
    rest = rest.slice(0, startA2) +
      '// 引擎为单例：临时打开随机度验证“同一开局不完全同手”，结束后恢复。\n' +
      'A.setMoveVariety(1);' +
      rest.slice(endA2 + 2);
    /* 把 A2 的调用改回 A */
    rest = rest.replace(/\bA2\./g, 'A.');
    /* 循环后恢复确定性 */
    const anchor = "checkTrue('随机出的每手都在天元 2 格内（开局库应答）', allNearCenter);";
    const at = rest.indexOf(anchor);
    if (at >= 0) rest = rest.slice(0, at + anchor.length) + '\nA.setMoveVariety(0);   // 恢复确定性' + rest.slice(at + anchor.length);
  }

  /* 结构断言：旧版检查“关键函数必须是 gomoku.html 的顶层声明”，
   * 引擎已独立成模块 → 改为读取引擎模块源码（并补上 src 声明）。 */
  if (rest.includes('braceDepthBefore')) {
    if (!/const src = /.test(rest)) {
      rest = rest.replace(
        "console.log('== 结构检查",
        "const src = fs.readFileSync(path.join(__dirname, '..', 'outputs', 'engine', 'gomoku-ai.js'), 'utf8');\nconsole.log('== 结构检查");
    }
    rest = rest.replace(/gomoku\.html/g, 'engine/gomoku-ai.js');
    /* 引擎函数现在包在 UMD 工厂函数里，因此“顶层”深度由 0 变为 1；
     * anchor 仍是“防止被意外嵌套进另一个函数”（那会变成 2 以上）。aiMove 不在引擎里，去掉。 */
    rest = rest.replace(
      /for \(const n of \[[^\]]*\]\) \{/,
      "for (const n of ['openingMove', 'bookMove', 'getBestMove', 'minimax', 'bestBySearch', 'findVcfWin', 'findVctWin']) {");
    rest = rest.replace(
      /check\('顶层声明: ' \+ n \+ ' \(深度 ' \+ d\.depth \+ ', 行 ' \+ d\.line \+ '\)', d\.depth, 0\);/,
      "check('模块内顶层声明: ' + n + ' (深度 ' + d.depth + ', 行 ' + d.line + ')', d.depth, 1);");
  }

  /* 旧测试直接给 playerColor / aiColor 赋值来模拟猜先切换；
   * 迁移后颜色由 harness 的 A.setColors 统一管理（两处成对出现）。 */
  rest = rest.replace(/^\s*playerColor\s*=\s*([A-Z_]+);\s*\n\s*aiColor\s*=\s*([A-Z_]+);\s*$/gm,
    'A.setColors($1, $2);');
  rest = rest.replace(/^\s*aiColor\s*=\s*([A-Z_]+);\s*\n\s*playerColor\s*=\s*([A-Z_]+);\s*$/gm,
    'A.setColors($2, $1);');
  /* 兜底：单行赋值也改写（避免 const 赋值报错） */
  rest = rest.replace(/^\s*aiColor\s*=\s*([A-Z_]+);/gm, 'A.setColors(A.playerColor, $1);');
  rest = rest.replace(/^\s*playerColor\s*=\s*([A-Z_]+);/gm, 'A.setColors($1, A.aiColor);');

  /* 旧测试用 A.getLastVctPath() / A.getLastVcfPath() 读取杀棋路径；
   * 引擎改成了 getter 属性 lastVctPath / lastVcfPath。 */
  rest = rest.replace(/A\.getLastVctPath\(\)/g, 'A.lastVctPath')
             .replace(/A\.getLastVcfPath\(\)/g, 'A.lastVcfPath');

  const withEval = file.includes('scoring');
  const header = makeHeader({ withEval });

  /* 兼容：scoring 测试的断言里用到 aiLevel（页面侧状态） */
  const extra = withEval ? '\nconst aiLevel = LEVEL_MEDIUM;\n' : '';

  const out = header + extra + rest;
  fs.writeFileSync(abs, out, 'utf8');
  console.log(`${file}: 替换加载头 ${startIdx + 1}~${endIdx + 1} 行 → require 引擎`);
}

if (problems.length) {
  console.log('\n!! 迁移失败:');
  for (const p of problems) console.log('  - ' + p);
  process.exit(1);
}
console.log('\n迁移完成');
