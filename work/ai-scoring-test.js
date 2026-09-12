// ============================================================
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

const aiLevel = LEVEL_MEDIUM;

let pass = 0, fail = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + ' 期望 ' + JSON.stringify(expected) + ' 实际 ' + JSON.stringify(actual)); }
}
function checkTrue(label, cond) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label); }
}

console.log('== 场景1：死四（两端被封）方向记 0，整体无威胁 ==');
reset();
put(WHITE, [[10, 5], [10, 6], [10, 7]]);
put(BLACK, [[10, 4], [10, 9]]);               // B X X X _ B
check('横向 directionScore(10,8) = 0（死四方向）', A.directionScore(10, 8, 0, 1, WHITE), 0);
check('evaluateCell(10,8) < 1000（无真实威胁分）', A.evaluateCell(10, 8, WHITE) < 1000, true);

console.log('== 场景2：真实冲四仍是高价值威胁 ==');
reset();
put(WHITE, [[10, 6], [10, 7], [10, 8]]);
put(BLACK, [[10, 5]]);                        // B X X X _（右侧有空位）
check('冲四 = 10000', A.directionScore(10, 9, 0, 1, WHITE), 10000);

console.log('== 场景3：活四（两端都开放）= 100000 ==');
reset();
put(WHITE, [[10, 6], [10, 7], [10, 8]]);      // _ X X X X _（两端都空）
check('活四 = 100000', A.directionScore(10, 9, 0, 1, WHITE), 100000);

console.log('== 场景4：活三（_ X X X _）保持 10000 ==');
reset();
put(WHITE, [[10, 6], [10, 7]]);
check('活三 = 10000', A.directionScore(10, 8, 0, 1, WHITE), 10000);

console.log('== 场景5：B X X X _ B 的死三记 0 ==');
reset();
put(WHITE, [[10, 6], [10, 7], [10, 8]]);
put(BLACK, [[10, 5], [10, 10]]);
check('死三 = 0', A.directionScore(10, 9, 0, 1, WHITE), 0);

console.log('== 场景6：空间足够时一步成五（返回任意制胜点） ==');
reset();
put(WHITE, [[10, 5], [10, 6], [10, 7], [10, 8]]);   // X X X X _
check('canWinNow(10,9) = true', A.canWinNow(10, 9, WHITE), true);
const win = A.findImmediateWin(WHITE);
const winOk = win && A.canWinNow(win[0], win[1], WHITE);
check('findImmediateWin 返回制胜点', winOk, true);

console.log('== 场景7：教学文案与棋型一致（含术语解释） ==');
reset();
put(BLACK, [[10, 6], [10, 7], [10, 8]]);
put(WHITE, [[10, 5], [10, 10]]);   // 玩家凑 B X X X X B → 死四
const deadFour = A.analyzePoint(10, 9, BLACK);
check('死四 count=4', deadFour.count, 4);
check('死四 open=0', deadFour.open, 0);
check('死四文案', A.patternText(deadFour), '形成了死四：两端都被封死，无法连成五子。');
reset();
put(BLACK, [[10, 6], [10, 7]]);
const liveThree = A.analyzePoint(10, 8, BLACK);
check('活三 count=3', liveThree.count, 3);
check('活三 open=2', liveThree.open, 2);
check('活三文案（含术语）', A.patternText(liveThree),
      '形成了活三（三子连珠且两端开放），下一步可发展成冲四，制造了很好的攻势！');
checkTrue('analyzePoint 返回方向 dr/dc', liveThree.dr === 0 && liveThree.dc === 1);

console.log('== 场景8：教学点评——玩家错过必杀 ==');
reset();
put(BLACK, [[10, 5], [10, 6], [10, 7], [10, 8], [3, 3]]);  // 四连 + 玩家下在 (3,3)
put(WHITE, [[2, 2]]);
const m1 = A.analyzePlayerMove(3, 3);
const winCell = A.findImmediateWin(BLACK);
checkTrue('点评提示“错过必杀”', m1.indexOf('错过') >= 0);
checkTrue('点评指出制胜点 ' + A.formatPos(winCell[0], winCell[1]),
          m1.indexOf(A.formatPos(winCell[0], winCell[1])) >= 0);

console.log('== 场景9：教学点评——AI 下一步可成五（防守警告） ==');
reset();
put(WHITE, [[10, 5], [10, 6], [10, 7], [10, 8]]);
put(BLACK, [[3, 3]]);
const m2 = A.analyzePlayerMove(3, 3);
const dangerCell = A.findImmediateWin(AI_COLOR);
checkTrue('点评提示“注意防守”', m2.indexOf('注意防守') >= 0);
checkTrue('点评指出危险点 ' + A.formatPos(dangerCell[0], dangerCell[1]),
          m2.indexOf(A.formatPos(dangerCell[0], dangerCell[1])) >= 0);

console.log('== 场景10：教学点评——玩家双三赞美 ==');
reset();
put(BLACK, [[10, 3], [10, 4], [8, 5], [9, 5], [10, 5]]);  // (10,5) 一手成双三
put(WHITE, [[2, 2]]);
const m3 = A.analyzePlayerMove(10, 5);
checkTrue('点评赞美“双三”', m3.indexOf('双三') >= 0);

console.log('== 场景11：教学点评——弱棋批评（游离棋） ==');
reset();
put(BLACK, [[2, 2]]);              // 玩家刚下 (2,2)，附近无棋子
put(WHITE, [[9, 9]]);
const weak = A.weakMoveReason(2, 2);
checkTrue('weakMoveReason 提示“游离”', weak !== null && weak.indexOf('游离') >= 0);
const m4 = A.analyzePlayerMove(2, 2);
checkTrue('analyzePlayerMove 对弱棋返回非空点评', typeof m4 === 'string' && m4.length > 0);

console.log('== 场景12：教学点评——更优推荐（玩家视角 forColor=BLACK） ==');
reset();
put(BLACK, [[10, 5], [10, 6], [10, 7], [3, 3]]);   // 活三 + 玩家下在 (3,3)
put(WHITE, [[2, 2]]);
const m5 = A.analyzePlayerMove(3, 3);
checkTrue('点评包含推荐（活四/冲四）', m5.indexOf('更推荐') >= 0 && (m5.indexOf('活四') >= 0 || m5.indexOf('冲四') >= 0));
// 推荐点（玩家视角）落在活三的两端之一（VCF 会选择先冲四的一端）
const rec = A.getBestMove(LEVEL_MEDIUM, BLACK);
checkTrue('getBestMove(medium, BLACK) 返回活三端点',
          rec && rec[0] === 10 && (rec[1] === 4 || rec[1] === 8));

console.log('== 场景13：猜先玩家执白时，AI/点评按动态颜色分析 ==');
// 模拟猜先结果：玩家执白、AI 执黑
A.setColors(WHITE, BLACK);
reset();
put(playerColor, [[10, 5], [10, 6], [10, 7]]);   // 玩家的活三（两端开放）
const blk = A.getBestMove(LEVEL_MEDIUM);          // 默认 aiColor=BLACK → 应堵玩家的活三
checkTrue('AI（黑）堵玩家（白）活三端点',
          blk && blk[0] === 10 && (blk[1] === 4 || blk[1] === 8));
const p = A.analyzePoint(10, 8, playerColor);     // 白在 (10,8) 可连成四
checkTrue('玩家视角棋型按执白颜色识别',
          p.count === 4 && p.open === 2);
A.setColors(BLACK, A.aiColor);                              // 还原默认，避免影响后续
A.setColors(A.playerColor, WHITE);

console.log('== 场景14：对手意图判断（analyzeOpponentIntent） ==');
reset();
put(BLACK, [[10, 5], [10, 6], [10, 7]]);          // 玩家的活三
const intent1 = A.analyzeOpponentIntent(10, 7, BLACK);
checkTrue('识别出“活三”意图', intent1.kind === 'live_three' && intent1.level === 2);
reset();
put(BLACK, [[9, 7], [9, 8], [7, 9], [8, 9], [9, 9]]);  // 一手成横竖双活三
const intent2 = A.analyzeOpponentIntent(9, 9, BLACK);
checkTrue('识别出“双杀陷阱”意图', intent2.kind === 'double_threat' && intent2.level === 3);
reset();
put(BLACK, [[10, 5], [10, 6], [10, 7], [10, 8]]); // 四连，右端被白堵住 → 冲四（单端开放）
put(WHITE, [[10, 9]]);
const intent3 = A.analyzeOpponentIntent(10, 8, BLACK);
checkTrue('识别出“冲四”意图', intent3.kind === 'rush_four');

console.log('== 场景15：胜率预测 estimateWinRate ==');
reset();   // 空盘：双方接近五五开
const wrEmpty = A.estimateWinRate();
checkTrue('空盘胜率接近 50%（|玩家-50| < 15）', Math.abs(wrEmpty.player - 50) < 15);
reset();
put(WHITE, [[10, 5], [10, 6], [10, 7], [10, 8]]); // AI 活四
const wrAi = A.estimateWinRate();
checkTrue('AI 活四 → AI 胜率 > 90', wrAi.ai > 90);
reset();
put(BLACK, [[10, 5], [10, 6], [10, 7], [10, 8]]); // 玩家活四
const wrP = A.estimateWinRate();
checkTrue('玩家活四 → 玩家胜率 > 90', wrP.player > 90);
reset();
put(WHITE, [[10, 5], [10, 6], [10, 7], [10, 8], [10, 9]]); // AI 已成五
const wrWin = A.estimateWinRate();
checkTrue('AI 一步成五 → AI 胜率锁定 98', wrWin.ai === 98);
reset();
put(BLACK, [[10, 5], [10, 6], [10, 7], [10, 8], [10, 9]]); // 玩家已成五
const wrLose = A.estimateWinRate();
checkTrue('玩家一步成五 → 玩家胜率锁定 98', wrLose.player === 98);

console.log('== 场景15B：防“假胜率”——强而不必胜的棋型不再飙到 98% ==');
reset();
// 玩家双三：横活三 (9,6)(9,7)(9,8) + 竖活二 (8,9)(10,9)，汇于空点 (9,9)
// 玩家在 (9,9) 一手可成“横活四 + 竖活三”双威胁（不可一手防尽，但并非立刻成五）
put(BLACK, [[9, 6], [9, 7], [9, 8]]);
put(BLACK, [[8, 9], [10, 9]]);
put(WHITE, [[12, 5], [12, 6], [13, 5]]);
const wrDt = A.estimateWinRate();
checkTrue('玩家双三 → 玩家胜率 < 90（不再误报 98%）', wrDt.player < 90, 'player=' + wrDt.player);
checkTrue('玩家双三 → 玩家胜率仍明显占优（> 55）', wrDt.player > 55, 'player=' + wrDt.player);
reset();
// 玩家活三：强而不必胜，胜率应在 50~90 之间（不能封顶 98）
put(BLACK, [[10, 6], [10, 7], [10, 8]]);
put(WHITE, [[12, 5], [12, 6]]);
const wrL3 = A.estimateWinRate();
checkTrue('玩家活三 → 胜率 < 90', wrL3.player < 90, 'player=' + wrL3.player);
checkTrue('玩家活三 → 胜率 > 50', wrL3.player > 50, 'player=' + wrL3.player);

console.log('== 场景15C：98% 锁定考虑回合权 ==');
reset();
// 玩家冲四（四连一端被封）：轮到 AI 时 AI 会先挡，不能算“锁定胜局”
put(BLACK, [[10, 6], [10, 7], [10, 8], [10, 9]]);
put(WHITE, [[10, 5]]);   // 左端封死，右端 (10,10) 是唯一成五点
const wrRushAiTurn = A.estimateWinRate(WHITE);   // 轮到 AI
checkTrue('玩家冲四但轮到 AI → 不锁定 98%（< 95）', wrRushAiTurn.player < 95, 'player=' + wrRushAiTurn.player);
const wrRushPlTurn = A.estimateWinRate(BLACK);   // 轮到玩家：下一步成五，锁定 98
checkTrue('玩家冲四且轮到玩家 → 锁定 98', wrRushPlTurn.player === 98, 'player=' + wrRushPlTurn.player);
reset();
// 活四无论谁行动都是无解的 → 仍应 > 90
put(BLACK, [[10, 6], [10, 7], [10, 8], [10, 9]]);
put(WHITE, [[12, 5]]);
const wrLiveFourAiTurn = A.estimateWinRate(WHITE);   // 轮到 AI 也挡不住活四
checkTrue('玩家活四且轮到 AI → 胜率仍 > 90', wrLiveFourAiTurn.player > 90, 'player=' + wrLiveFourAiTurn.player);

console.log('\n结果：' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);


