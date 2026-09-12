// 重构脚本：把 gomoku.html 的内联 AI 引擎替换为加载 outputs/engine/gomoku-ai.js。
//
// 安全设计（吃过一次亏，这次严格按此执行）：
//   1) 全程在内存里做变换，绝不中途写文件；
//   2) 产物先写 work/_html-split-candidate.html，再用独立校验函数逐项检查；
//   3) 校验全过才覆盖 outputs/gomoku.html，并先备份到 work/archive/。
// 用法: node work/_rewrite-html-for-engine.js
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FILE = path.join(ROOT, 'outputs', 'gomoku.html');
const CANDIDATE = path.join(ROOT, 'work', '_html-split-candidate.html');
const BACKUP = path.join(ROOT, 'work', 'archive', 'gomoku.html.pre-engine-split');

const problems = [];
const notes = [];
const assert = (cond, msg) => { if (!cond) problems.push(msg); return cond; };

/* ============================================================
 * 0. 读入（一次性，之后不再重新读取）
 * ============================================================ */
let lines = fs.readFileSync(FILE, 'utf8').split(/\r?\n/);
const originalLineCount = lines.length;
assert(originalLineCount === 4689, `读取行数异常: ${originalLineCount}（期望 4689）`);

/** 按“整行完全相等”替换；成功返回 true */
function replaceLine(from, to, label) {
  const idx = lines.findIndex(l => l === from);
  if (idx < 0) { problems.push(`[${label}] 未找到整行: ${JSON.stringify(from.slice(0, 60))}`); return false; }
  if (lines.filter(l => l === from).length > 1) { problems.push(`[${label}] 匹配到多行，需更具体`); return false; }
  lines[idx] = to;
  return true;
}
/** 按连续多行块替换；成功后空行会被剔除 */
function replaceBlock(fromLines, toLines, label) {
  const first = fromLines[0];
  const idx = lines.findIndex(l => l === first);
  if (idx < 0) { problems.push(`[${label}] 未找到首行: ${JSON.stringify(first.slice(0, 60))}`); return false; }
  for (let k = 0; k < fromLines.length; k++) {
    if (lines[idx + k] !== fromLines[k]) {
      problems.push(`[${label}] 第 ${k + 1} 行不匹配: ${JSON.stringify(String(lines[idx + k]).slice(0, 60))}`);
      return false;
    }
  }
  lines.splice(idx, fromLines.length, ...toLines);
  return true;
}
/** 按内容定位区块边界（返回 [startIdx, endIdxExclusive]）
 *  ★ 起点会回退一行，以包含区块开头的 '/* ====' 起始符。
 *    若不回退，替换时会漏掉起始符，造成注释结构错乱（曾导致状态块注释悬空、
 *    内联脚本 SyntaxError: Unexpected token '*'）。 */
function findRange(startMarker, endMarker, label) {
  let s = lines.findIndex(l => l.includes(startMarker));
  if (s < 0) { problems.push(`[${label}] 找不到起点标记: ${startMarker}`); return null; }
  if (s > 0 && lines[s - 1].startsWith('/* ====')) s -= 1;
  let e = -1;
  for (let i = s + 1; i < lines.length; i++) if (lines[i].includes(endMarker)) { e = i; break; }
  if (e < 0) { problems.push(`[${label}] 找不到终点标记: ${endMarker}`); return null; }
  if (e > 0 && lines[e - 1].startsWith('/* ====')) e -= 1;   // 终止符归下一区块所有
  return [s, e];
}

/* ============================================================
 * 1. 整行替换（此时标识符仍是原名；全局改写放在更后面，避免把
 *    `let playerColor` 这种声明改写成 `let AI.playerColor` 而让声明清理失配）
 * ============================================================ */
replaceLine('  board = Array.from({ length: boardSize }, () => Array(boardSize).fill(EMPTY));',
  '  AI.setBoardSize(boardSize);               // 棋盘由引擎持有：AI.board 是唯一数据源（不接收返回值！它是棋盘数组）\n' +
  '  AI.setMoveVariety(1);                     // 出棋随机度：0=完全确定（测试），1=正常',
  'init 棋盘创建');

replaceLine('  board = Array.from({ length: size }, () => Array(size).fill(EMPTY));',
  '  AI.setBoardSize(size);   // 引擎重建棋盘（同时更新尺寸、清空、重置搜索缓存）',
  'applyOnlineRoomSize 重建棋盘');
replaceLine('  boardSize = size;', '  boardSize = size; AI.setBoardSize(size);', 'applyOnlineRoomSize 尺寸');

replaceLine('  board = msg.board.map((row) => row.slice());',
  '  AI.resizeBoard(msg.boardSize || msg.board.length);\n' +
  '  for (let r = 0; r < AI.boardSize; r++) for (let c = 0; c < AI.boardSize; c++) AI.board[r][c] = (msg.board[r][c] || 0);',
  'applySnapshot 恢复棋盘');

replaceLine('    playerColor = playerIsBlack ? BLACK : WHITE;',
  '    AI.setColors(playerIsBlack ? BLACK : WHITE, playerIsBlack ? WHITE : BLACK);',
  '猜先同步颜色');
replaceBlock(['    aiColor = playerIsBlack ? WHITE : BLACK;'], [], '猜先删除 aiColor 赋值');

replaceLine('    const book = bookMove(level, me);', '    const book = AI.bookMove(level, me);', 'bookMove 调用');
replaceLine('      const o = openingMove(level);', '      const o = AI.openingMove(level);', 'openingMove 调用');
/* getBestMove 随引擎区块一起删除，页面改为调用引擎 */
replaceLine('  const move = getBestMove(aiLevel);', '  const move = AI.getBestMove(aiLevel);', 'aiMove 调用引擎');
replaceLine('  const best = getBestMove(eduRecommendLevel(), playerColor);',
  '  const best = AI.getBestMove(eduRecommendLevel(), playerColor);', 'analyzePlayerMove 调用引擎');
replaceLine('  hintMove = getBestMove(eduRecommendLevel(), playerColor);',
  '  hintMove = AI.getBestMove(eduRecommendLevel(), playerColor);', 'refreshHint 调用引擎');

replaceLine('  hashXor(r, c, currentPlayer);     // 同步维护 Zobrist 棋盘哈希，供困难档置换表使用',
  '  AI.hashXor(r, c, currentPlayer);  // 同步维护引擎的 Zobrist 棋盘哈希',
  'placeStone 哈希');

replaceBlock([
  '  lastVcfPath = null;               // 新一局清掉上次 VCF 杀棋路径',
  '  lastVctPath = null;               // 新一局清掉上次 VCT 杀棋路径',
], [], 'init 清空杀棋路径');
replaceBlock(['    lastVcfPath = null;', '    lastVctPath = null;'], [], 'onExit 清空杀棋路径');

/* undo() 里的三处 hashXor → AI.hashXor（缩进不同，逐个处理） */
const hashPatterns = [
  '    hashXor(r, c, color1);          // 出棋：读盘面颜色后从哈希中异或掉',
  '      hashXor(r2, c2, color2);      // 出棋：读盘面颜色后从哈希中异或掉',
  '    hashXor(r, c, color);           // 出棋：读盘面颜色后从哈希中异或掉',
];
let hashFixed = 0;
for (const p of hashPatterns) {
  if (replaceLine(p, p.replace('hashXor(', 'AI.hashXor('), 'undo 哈希')) hashFixed++;
}
assert(hashFixed === 3, `undo() 哈希改写应 3 处，实际 ${hashFixed}`);

/* ============================================================
 * 2. 删除 “八、AI” 区块（保留一段说明）
 * ============================================================ */
{
  const iComment = lines.findIndex(l => l.includes(' * 八、AI（三档难度）'));
  assert(iComment > 0, '找不到“八、AI”区块注释');
  let blockStart = iComment;
  while (blockStart > 0 && !lines[blockStart].startsWith('/* ====')) blockStart--;

  /* ★ 删除终点不能用“九、教育模式”的注释块：aiMove / analyzeOpponentIntent /
   *   commentOnAiMove 等属于“九”的代码在物理位置上夹在引擎函数与“九”的注释之间
   *   （引擎函数 2649~4002，aiMove 在 4005，而“九”的注释在 4110）。
   *   若删到 4110，就会把 aiMove 一并删掉，运行时报 "aiMove is not defined"。
   *   正确终点 = aiMove 定义行的前一行。 */
  const aiMoveLine = lines.findIndex(l => /^function\s+aiMove\s*\(/.test(l));
  assert(aiMoveLine > blockStart, '找不到 function aiMove（应位于引擎区块之后）');
  let blockEnd = aiMoveLine;
  while (blockEnd > blockStart && lines[blockEnd - 1].trim() === '') blockEnd--;

  /* 诊断：确认删除区间没有吃掉页面结构，也没有吃掉 aiMove */
  const head = lines.slice(Math.max(0, blockStart - 3), blockStart + 2).join(' | ').slice(0, 160);
  const tail = lines.slice(blockEnd - 2, blockEnd + 3).join(' | ').slice(0, 160);
  notes.push(`AI 引擎区块 L${blockStart + 1}~L${blockEnd}（共 ${blockEnd - blockStart} 行）`);
  notes.push(`  区间前: ${head}`);
  notes.push(`  区间后: ${tail}`);
  const hasCanvasInRange = lines.slice(blockStart, blockEnd).some(l => l.includes('<canvas'));
  assert(!hasCanvasInRange, 'AI 删除区间里竟然包含 <canvas>，区间定位有误');
  const fnCountInRange = lines.slice(blockStart, blockEnd).filter(l => /^function\s/.test(l)).length;
  notes.push(`  区间内顶层函数数: ${fnCountInRange}（期望 40：inBoard 之外的引擎闭包）`);
  assert(fnCountInRange >= 35, `区间内函数数偏少（${fnCountInRange}），疑似区间定位错误`);

  assert(blockEnd > blockStart, 'AI 区块边界顺序异常');
  const removed = blockEnd - blockStart;
  lines.splice(blockStart, removed,
    '/* ============================================================',
    ' * 八、AI 引擎（已抽成独立模块 outputs/engine/gomoku-ai.js）',
    ' * ------------------------------------------------------------',
    ' * 三档难度的全部实现——VCF/VCT 连杀、双杀与双三阵法、棋型评分、',
    ' * Alpha-Beta 搜索、置换表与历史启发、开局库——现在只有一份权威副本：',
    ' *   outputs/engine/gomoku-ai.js',
    ' * 本页通过全局 GomokuAI 调用它，不再内联实现，避免两份代码漂移。',
    ' * 重新生成: node work/build-engine.js    一致性验证: node work/verify-engine-parity.js',
    ' * ============================================================ */');
}

/* ============================================================
 * 3. 删除开局库字面量
 * ============================================================ */
{
  const iBook = lines.findIndex(l => l.startsWith('const OPENING_BOOK = {'));
  assert(iBook > 0, '找不到开局库字面量');
  let iEnd = iBook;
  while (iEnd < lines.length && !lines[iEnd].trimEnd().endsWith('};')) iEnd++;
  const span = iEnd - iBook + 1;
  assert(span <= 3, `开局库字面量跨 ${span} 行，预期 1~3 行`);
  notes.push(`开局库字面量删除 ${span} 行`);
  lines.splice(iBook, span,
    '/* 开局库已内联进引擎模块（outputs/engine/opening-book.json 为可读副本），本页不再保留。 */');
}

/* ============================================================
 * 4. 常量块：只留页面/框架常量，其余从 GomokuAI 取
 * ============================================================ */
{
  const range = findRange(' * 一、常量与配置', ' * 二、全局状态', '常量块');
  if (range) {
    notes.push(`常量块替换 ${range[1] - range[0]} 行`);
    notes.push(`  range[0]=${range[0]} 该行=${JSON.stringify(lines[range[0]])}`);
    notes.push(`  range[0]-1=${JSON.stringify(lines[range[0] - 1])}`);
    const newConstLines = [
      '/* ============================================================',
      ' * 一、常量与配置',
      ' * 说明：AI 相关常量（搜索参数、棋型分值表、开局库…）已全部移入引擎模块',
      ' *       outputs/engine/gomoku-ai.js；本页只保留页面/对局框架用得到的常量，',
      ' *       与引擎共享的那部分直接从 GomokuAI 取，保证只有一份定义。',
      ' * ============================================================ */',
      '/* 引擎持有的棋盘与状态（唯一数据源）：board / boardSize / playerColor / aiColor',
      ' * / moveVariety / lastVcfPath / lastVctPath / 搜索缓存，全部通过 AI.* 访问。 */',
      'const {',
      '  EMPTY, BLACK, WHITE, DIRECTIONS,',
      '  LEVEL_EASY, LEVEL_MEDIUM, LEVEL_HARD,',
      '  OPENING_TOTAL_MOVES,',
      '} = AI;',
      '',
      'const MODE_PVP = \'pvp\';           // 双人对战',
      'const MODE_PVE = \'pve\';           // 人机对战（默认玩家执黑、AI 执白，猜先可互换）',
      'const MODE_ONLINE = \'online\';     // 在线对战（WebSocket 双人实时对弈）',
      'const AI_DELAY = 250;             // AI 落子前的最小延迟（毫秒）',
      '',
      '/* 页面/对局框架专用：可选棋盘格数、默认格数、渲染尺寸 */',
      'const BOARD_SIZES = [13, 15, 19];',
      'const DEFAULT_BOARD_SIZE = 19;',
      'const CELL_SIZE = 40;',
      'const MARGIN = 20;',
      '/* 胜率估算参数（页面侧 estimateWinRate 使用，与引擎评估分口径配合） */',
      'const WIN_RATE_SCALE = 40000;',
      'const WIN_RATE_COMBO_WEIGHT = 0.25;',
      'let boardSize = AI.boardSize;      // 当前棋盘格数（与引擎同步，供画布计算用）',
      '/* AI 默认执白；猜先后由引擎的 aiColor 决定实际执子 */',
      '',
    ];
    lines.splice(range[0], range[1] - range[0], ...newConstLines);
  }
}

/* ============================================================
 * 5. 状态块：删掉已移入引擎的变量声明与全局 board
 * ============================================================ */
{
  const range = findRange(' * 二、全局状态', ' * 三、DOM 引用', '状态块');
  if (range) {
    const block = lines.slice(range[0], range[1]);
    const removePrefixes = [
      'let playerColor', 'let aiColor', 'let moveVariety',
      'let boardSize', 'let board;', 'let lastVcfPath', 'let lastVctPath', 'let searchState',
      'let ttMap', 'let ttZobrist', 'let boardHash', 'let historyTable', 'let killerTable',
    ];
    /* 注意：aiLevel 属于“页面自有状态”（不在引擎里），因此保留在状态块、不删。
     * 曾误加进删除清单，导致常量块里的 let aiLevel 与状态块残留重复声明。 */
    const removedNames = [];
    const kept = block.filter(l => {
      const t = l.trim();
      const hit = removePrefixes.find(p => t.startsWith(p));
      if (hit) { removedNames.push(hit.replace('let ', '').replace(';', '')); return false; }
      return true;
    });
    assert(removedNames.length === removePrefixes.length,
      `状态块删除数量不符：${removedNames.length}/${removePrefixes.length}（已删 ${removedNames.join(',')}）`);
    /* 声明不能重复：常量块已声明 boardSize，状态块里不应再出现；
     * aiLevel 属于页面自有状态（只在状态块声明），不在此检查范围。 */
    const dupDecl = kept.filter(l => /^\s*(let|const|var)\s+(boardSize|board|playerColor|aiColor|moveVariety)\b/.test(l));
    assert(dupDecl.length === 0, '状态块残留重复声明: ' + dupDecl.map(l => l.trim()).join(' | '));
    notes.push(`状态块删除 ${block.length - kept.length} 行声明`);
    lines.splice(range[0], block.length, ...kept);
  }
}

/* ============================================================
 * 6. 全局标识符改写：游戏侧改为走 AI.*
 *    ★ 必须在“区块删除/声明清理”之后做，否则 `let playerColor` 会先被改写成
 *      `let AI.playerColor`，导致状态声明清理失配（曾因此只删掉 1 个声明）。
 *    关键：排除被引号包裹的字符串/HTML 属性值——否则 id="board" 会被改成
 *      id="AI.board"（曾因此把 <canvas id="board"> 改坏，锚点全部失配）。
 * ============================================================ */
let text = lines.join('\n');
const IDENT_MAP = {
  board: 'AI.board',
  playerColor: 'AI.playerColor',
  aiColor: 'AI.aiColor',
  moveVariety: 'AI.moveVariety',
  lastVcfPath: 'AI.lastVcfPath',
  lastVctPath: 'AI.lastVctPath',
  searchState: 'AI.searchState',
  ttMap: 'AI.ttMap',
  ttZobrist: 'AI.ttZobrist',
  boardHash: 'AI.boardHash',
  historyTable: 'AI.historyTable',
  killerTable: 'AI.killerTable',
};
const identCounts = {};
/* ★ 顺序关键：先在“原名称”状态下把对引擎只读属性（playerColor / aiColor /
 * moveVariety 都是 getter）的赋值改写成 setter 调用；再做泛化改名。
 * 反过来的话赋值目标会先变成 AI.playerColor，就再也匹配不到裸名了。 */
const assignCounts = { playerColor: 0, aiColor: 0, moveVariety: 0 };
for (const [bare, key, make] of [
  ['playerColor', 'playerColor', (v) => `AI.setColors(${v}, AI.aiColor);`],
  ['aiColor', 'aiColor', (v) => `AI.setColors(AI.playerColor, ${v});`],
  ['moveVariety', 'moveVariety', (v) => `AI.setMoveVariety(${v});`],
]) {
  const re = new RegExp('(?<![\\w.$\'"`])' + bare + '\\s*=\\s*([^;\\n]+);', 'g');
  text = text.replace(re, (m, rhs) => {
    /* 跳过声明本身（let/const/var）与比较运算 */
    if (/^\s*(let|const|var)\b/.test(m)) return m;
    assignCounts[key]++;
    return make(rhs.trim());
  });
}
notes.push('只读属性赋值改写: ' + Object.entries(assignCounts).map(([k, v]) => `${k}=${v}`).join(' '));
/* init() 里必然给 playerColor/aiColor 各赋一次（改为 setColors 调用） */
assert(assignCounts.playerColor >= 1 && assignCounts.aiColor >= 1,
  `颜色赋值改写缺失（playerColor=${assignCounts.playerColor}, aiColor=${assignCounts.aiColor}）`);

/* ★ 引擎函数不再内联在页面里，所有裸调用都必须加 AI. 前缀，
 *   否则运行时报 "xxx is not defined"（例如 estimateWinRate 里的 findImmediateWin）。
 *   注意只匹配“函数调用”形态（名字后紧跟括号），避免误伤普通标识符。 */
const ENGINE_FNS = ['getBestMove', 'findImmediateWin', 'findVcfWin', 'findVctWin',
  'findDoubleThreat', 'findDoubleKill', 'findOpponentDoubleThreat', 'threatLevel',
  'countThreats', 'canWinNow', 'evaluateBoard', 'evaluateCell', 'lineInfo', 'lineScore',
  'scoreFor', 'getCandidateMoves', 'resolveThreats', 'searchDepth', 'bookMove', 'openingMove',
  'pickVaried', 'pickTopN', 'forcingMovesOf', 'comboBonus', 'threatSpaceBonus', 'hashXor',
  'bestBySearch', 'bestByScore', 'initSearchTables', 'directionScore'];
const bareCallCounts = {};
for (const fn of ENGINE_FNS) {
  const re = new RegExp('(?<![\\w.$\'"`])' + fn + '\\s*\\(', 'g');
  const n = (text.match(re) || []).length;
  if (n) {
    bareCallCounts[fn] = n;
    text = text.replace(re, 'AI.' + fn + '(');
  }
}
if (Object.keys(bareCallCounts).length) {
  notes.push('引擎函数补 AI. 前缀: ' + Object.entries(bareCallCounts).map(([k, v]) => `${k}=${v}`).join(' '));
}
/* 页面不得再出现任何裸引擎函数调用 */
{
  const leftovers = [];
  for (const fn of ENGINE_FNS) {
    const re = new RegExp('(?<![\\w.$\'"`])' + fn + '\\s*\\(', 'g');
    const n = (text.match(re) || []).length;
    if (n) leftovers.push(`${fn}(${n})`);
  }
  assert(leftovers.length === 0, '仍有裸引擎函数调用: ' + leftovers.join(', '));
}

for (const [from, to] of Object.entries(IDENT_MAP)) {
  const re = new RegExp('(?<![\\w.$\'"`])' + from + '\\b', 'g');
  identCounts[from] = (text.match(re) || []).length;
  text = text.replace(re, to);
}
{
  const dup = (text.match(/AI\.AI\./g) || []).length;
  if (dup) { text = text.replace(/AI\.AI\./g, 'AI.'); notes.push(`修正 ${dup} 处 AI.AI.`); }
}
notes.push('全局标识符改写: ' + Object.entries(identCounts).map(([k, v]) => `${k}=${v}`).join(' '));

/* ============================================================
 * 7. boardSize 镜像变量已在第 4 步的常量块里声明（let boardSize = AI.boardSize），
 *    此处不再重复插入。
 * ============================================================ */

/* 6.3 补上引擎引用声明（必须在内联脚本最上方，早于任何 AI. 使用） */
{
  const anchor = "'use strict';";
  const i = text.indexOf(anchor);
  assert(i >= 0, '找不到内联脚本的 \'use strict\';');
  text = text.slice(0, i + anchor.length) +
    "\n\n/* AI 引擎（独立模块 outputs/engine/gomoku-ai.js，浏览器下由 <script> 暴露为 GomokuAI） */\n" +
    "const AI = GomokuAI;" +
    text.slice(i + anchor.length);
}

/* 6.4 诊断 + 断言 */
{
  const linesArr = text.split('\n');
  const report = (re, label) => {
    const hits = [];
    linesArr.forEach((l, i) => { if (re.test(l)) hits.push(`${i + 1}: ${l.trim().slice(0, 92)}`); });
    if (hits.length) notes.push(`${label}（${hits.length} 处）\n      ` + hits.slice(0, 6).join('\n      '));
    return hits;
  };
  const badAssign = report(/(?<![\w.$])AI\.(board|boardSize)\s*=[^=]/, 'AI.board/boardSize 赋值左侧');
  /* 裸标识符检查：排除 CSS 选择器 #board、对象字面量键 'board:' 与带引号的形式 */
  const bareBoard = report(/(?<![\w.$#'"`])board\b(?!\s*:)/, '裸 board');
  const bareGetBest = report(/(?<![\w.$'"`])getBestMove\s*\(/, '裸 getBestMove 调用');
  if (badAssign.length) problems.push('AI.board 出现在赋值左侧（应改用 AI.setBoardSize / AI.board[r][c]）');
  if (bareGetBest.length) problems.push('仍有裸 getBestMove 调用未改为 AI.getBestMove');
  if (bareBoard.length) problems.push(`仍存在裸标识符 board（${bareBoard.length} 处）`);
}

/* ============================================================
 * 7. 插入引擎脚本引用
 * ============================================================ */
{
  /* 诊断：插入点前后到底长什么样 */
  const iCanvas = text.indexOf('<canvas');
  notes.push(`<canvas 位置: ${iCanvas}` + (iCanvas >= 0 ? ` → ${JSON.stringify(text.slice(iCanvas, iCanvas + 40))}` : '（不存在！）'));
  const iScript = text.indexOf('<script>');
  notes.push(`首个 <script> 位置: ${iScript} → ${iScript >= 0 ? JSON.stringify(text.slice(Math.max(0, iScript - 30), iScript + 10)) : '（不存在）'}`);
  notes.push(`已注入 <script src>: ${text.includes('engine/gomoku-ai.js')}`);
  notes.push(`const AI = GomokuAI 存在: ${/const\s+AI\s*=\s*GomokuAI/.test(text)}`);

  const anchor = '<canvas id="board"></canvas>\n\n<script>';
  if (!text.includes(anchor)) {
    /* 退一步：用更宽松的锚点（允许中间有空行/注释），并记录实际形态 */
    const loose = /(<canvas id="board"><\/canvas>\s*)<script>/;
    const m = loose.exec(text);
    if (m) {
      notes.push('使用宽松锚点注入');
      text = text.replace(loose, '$1\n<!-- AI 引擎：唯一权威实现，可用 node work/build-engine.js 重新生成 -->\n<script src="engine/gomoku-ai.js"></script>\n\n<script>');
    } else {
      problems.push('找不到插入引擎脚本的位置（严格与宽松锚点都失败）');
    }
  } else {
    text = text.replace(anchor,
      '<canvas id="board"></canvas>\n\n' +
      '<!-- AI 引擎：唯一权威实现，可用 node work/build-engine.js 重新生成 -->\n' +
      '<script src="engine/gomoku-ai.js"></script>\n\n<script>');
  }
}

/* ============================================================
 * 8. 校验（全过才写文件）
 * ============================================================ */
const mustHave = [
  ['引擎脚本引用', /<script src="engine\/gomoku-ai\.js"><\/script>/],
  ['从引擎取常量', /const\s*\{[\s\S]{0,200}?\}\s*=\s*AI;/],
  ['boardSize 声明', /^let boardSize = AI\.boardSize;/m],
  ['AI.setBoardSize 调用', /AI\.setBoardSize\(/],
  ['AI.setColors 调用', /AI\.setColors\(/],
  ['AI.board 使用', /AI\.board\[/],
  ['AI.getBestMove 调用', /AI\.getBestMove\(/],
  ['AI.hashXor 调用', /AI\.hashXor\(/],
];
for (const [label, re] of mustHave) assert(re.test(text), '产物缺少: ' + label);

const mustNot = [
  ['内联 getBestMove', /^function\s+getBestMove\s*\(/m],
  ['内联 minimax', /^function\s+minimax\s*\(/m],
  ['内联 findVcfWin', /^function\s+findVcfWin\s*\(/m],
  ['内联 findVctWin', /^function\s+findVctWin\s*\(/m],
  ['内联 bestBySearch', /^function\s+bestBySearch\s*\(/m],
  ['内联 PATTERN_TABLE', /^const\s+PATTERN_TABLE\b/m],
  ['内联 OPENING_BOOK 字面量', /^const OPENING_BOOK = \{/m],
  ['重复前缀 AI.AI.', /AI\.AI\./],
  ['残留 let board;', /^\s*let\s+board;/m],
  ['残留 let aiColor', /^\s*let\s+aiColor/m],
];
for (const [label, re] of mustNot) assert(!re.test(text), '产物残留: ' + label);

/* 引用的引擎 API 必须真实存在（加载模块并检查） */
const AI = require(path.join(ROOT, 'outputs', 'engine', 'gomoku-ai.js'));
const usedApi = new Set([...text.matchAll(/\bAI\.([A-Za-z_$][\w$]*)/g)].map(m => m[1]));
const missingApi = [...usedApi].filter(k => !(k in AI));
assert(missingApi.length === 0, '引用了引擎不存在的成员: ' + missingApi.join(', '));
notes.push('页面引用的引擎成员: ' + [...usedApi].sort().join(', '));

/* ============================================================
 * 8.5 结构自检：注释配平 + 内联脚本可真正解析
 *      这两项是"血泪教训"——只查字符串存在性会漏掉注释错乱导致的语法错误。
 * ============================================================ */
{
  const openComments = (text.match(/\/\*/g) || []).length;
  const closeComments = (text.match(/\*\//g) || []).length;
  assert(openComments === closeComments, `注释不配平: /* ${openComments} 个 vs */ ${closeComments} 个`);

  const inlineScripts = [...text.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  assert(inlineScripts.length === 1, `内联 <script> 数量异常: ${inlineScripts.length}（期望 1）`);
  if (inlineScripts.length === 1) {
    const vm = require('vm');
    try {
      new vm.Script(inlineScripts[0], { filename: 'gomoku.html:inline' });
      notes.push(`内联脚本语法校验通过（${inlineScripts[0].split('\n').length} 行）`);
    } catch (e) {
      const line = (e.stack || '').split('\n').find(l => l.includes('gomoku.html:inline')) || '';
      const src = inlineScripts[0].split('\n');
      const m = /:(\d+)/.exec(line);
      const at = m ? Number(m[1]) : 0;
      const ctx = at ? src.slice(Math.max(0, at - 3), at + 2).map((l, i) => `\n        ${at - 2 + i}| ${l}`).join('') : '';
      problems.push(`内联脚本语法错误: ${e.message}${ctx}`);
    }
  }

  /* 关键区块锚点必须成对出现且顺序正确 */
  const anchors = [' * 一、常量与配置', ' * 二、全局状态', ' * 三、DOM 引用', ' * 八、AI 引擎', ' * 九、教育模式'];
  let last = -1;
  for (const a of anchors) {
    const i = text.split('\n').findIndex(l => l.includes(a));
    assert(i > last, `区块顺序异常或缺失: ${a}（行 ${i}）`);
    last = i;
  }
}

console.log('==== HTML 引擎拆分报告 ====');
console.log(`原始行数 ${originalLineCount} → 产物行数 ${text.split('\n').length}`);
for (const n of notes) console.log('  · ' + n);
console.log(`产物大小 ${(Buffer.byteLength(text, 'utf8') / 1024).toFixed(1)}KB（原始 ${(fs.statSync(FILE).size / 1024).toFixed(1)}KB）`);

console.log('');
if (problems.length) {
  console.log('!! 校验失败，未改动任何文件:');
  for (const p of problems) console.log('  - ' + p);
  process.exit(1);
}
console.log('校验全部通过');

/* 先写候选文件，再覆盖正式文件（保留备份） */
fs.writeFileSync(CANDIDATE, text, 'utf8');
fs.mkdirSync(path.dirname(BACKUP), { recursive: true });
fs.copyFileSync(FILE, BACKUP);
fs.writeFileSync(FILE, text, 'utf8');
console.log('已写出: outputs/gomoku.html');
console.log('候选:   work/_html-split-candidate.html');
console.log('备份:   work/archive/gomoku.html.pre-engine-split');
