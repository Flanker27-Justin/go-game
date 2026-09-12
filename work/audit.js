// 阶段0之后的复检：确认此前分析中的关键缺陷是否仍然存在、以及引擎独立后是否更易修。
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const ENGINE = path.join(ROOT, 'outputs', 'engine', 'gomoku-ai.js');
const HTML = path.join(ROOT, 'outputs', 'gomoku.html');
const A = require(ENGINE);

const S = 19, EMPTY = 0, BLACK = 1, WHITE = 2;
A.setMoveVariety(0);
A.setBoardSize(S);
A.setColors(BLACK, WHITE);

console.log('===== 1. 棋型分值表现状（冲四 vs 活三 是否仍同分）=====');
console.log('PATTERN_TABLE =', JSON.stringify(A.PATTERN_TABLE));
console.log('  → 行=连子数，列=开放端数(0/1/2)');
const rushFour = A.PATTERN_TABLE[4][1];   // 冲四
const liveThree = A.PATTERN_TABLE[3][2];  // 活三
console.log(`  冲四=${rushFour} 活三=${liveThree} → ${rushFour === liveThree ? '仍然同分（组合判断无法区分）' : '已分层'}`);
console.log(`  眠三=${A.PATTERN_TABLE[3][1]} 活二=${A.PATTERN_TABLE[2][2]} 眠二=${A.PATTERN_TABLE[2][1]}`);
console.log(`  countThreats 判定阈值 LIVE_THREE_SCORE=${A.LIVE_THREE_SCORE}（眠三 ${A.PATTERN_TABLE[3][1]} < 阈值，OK）`);

console.log('\n===== 2. 评估函数是否仍只数连子（跳型敏感度）=====');
function clear() { for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) A.board[r][c] = EMPTY; }
function put(color, cells) { for (const [r, c] of cells) A.board[r][c] = color; }
clear(); put(WHITE, [[10, 5], [10, 6], [10, 7]]);
const connected = A.evaluateBoard(WHITE, BLACK, 1, null);
clear(); put(WHITE, [[10, 5], [10, 6], [10, 8]]);
const broken = A.evaluateBoard(WHITE, BLACK, 1, null);
console.log(`  白连活三 XXX  evaluateBoard = ${connected}`);
console.log(`  白跳活三 X_XX evaluateBoard = ${broken}`);
console.log(`  跳型得分是连型的 ${(broken / connected * 100).toFixed(0)}% → ${broken / connected < 0.6 ? '仍显著低估跳型' : '已接近'}`);

console.log('\n===== 3. 决策层分布（引擎独立后，插桩更容易了）=====');
const src = fs.readFileSync(ENGINE, 'utf8');
const counters = {};
/* 用源码文本统计“某层被 getBestMove 直接返回”的次数：在 getBestMove 体内数 return 语句归属 */
const gmStart = src.indexOf('function getBestMove(');
const gmEnd = src.indexOf('\nfunction ', gmStart + 10);
const gmBody = src.slice(gmStart, gmEnd);
const returns = [...gmBody.matchAll(/return\s+([A-Za-z_$][\w$]*)\(/g)].map(m => m[1]);
console.log('  getBestMove 里“直接返回某层结果”的位置:');
for (const [i, r] of returns.entries()) console.log(`    ${i + 1}. ${r}(...)`);
console.log(`  共 ${returns.length} 处短路返回（每处都是绕过搜索直接落子）`);
console.log(`  最后一次兜底: ${/(return bestBySearch|return bestByScore)/.test(gmBody) ? 'bestBySearch/bestByScore' : '未知'}`);

console.log('\n===== 4. 实测：搜索到底跑没跑（一局 60 手，统计耗时分布）=====');
clear();
A.board[9][9] = BLACK;
let stones = 1;
const times = [];
const holes = [];
while (stones < 60) {
  const color = stones % 2 === 1 ? WHITE : BLACK;
  const t0 = Date.now();
  const mv = A.getBestMove('hard', color);
  const dt = Date.now() - t0;
  times.push(dt);
  if (dt < 5) holes.push(stones);
  A.board[mv[0]][mv[1]] = color;
  stones++;
}
const fast = times.filter(t => t < 5).length;
console.log(`  ${times.length} 步中，耗时 <5ms（几乎肯定没进搜索）的有 ${fast} 步 = ${(fast / times.length * 100).toFixed(0)}%`);
console.log(`  耗时分布: <5ms ${fast} | 5-100ms ${times.filter(t => t >= 5 && t < 100).length} | 100-500ms ${times.filter(t => t >= 100 && t < 500).length} | >500ms ${times.filter(t => t >= 500).length}`);

console.log('\n===== 5. 页面侧仍缺失的能力（关键词扫描）=====');
const html = fs.readFileSync(HTML, 'utf8');
const probes = [
  ['devicePixelRatio（高分屏清晰度）', 'devicePixelRatio'],
  ['touchstart（移动端触控）', 'touchstart'],
  ['addEventListener("resize"（响应式）', 'addEventListener(\'resize\'' ],
  ['matchMedia（媒体查询）', 'matchMedia'],
  ['Worker（后台搜索，防冻结）', 'new Worker'],
  ['requestAnimationFrame（渲染优化）', 'requestAnimationFrame'],
  ['localStorage（存档/续局）', 'localStorage'],
  ['AudioContext（音效）', 'AudioContext'],
  ['导出棋谱/存档', 'exportGame'],
  ['计时/读秒', 'countdown'],
  ['认输', '认输'],
];
for (const [label, kw] of probes) {
  const n = html.split(kw).length - 1;
  console.log(`  ${n > 0 ? '有' : '无'}  ${label}${n ? `（出现 ${n} 次）` : ''}`);
}

console.log('\n===== 6. 页面体积与结构 =====');
const hlines = html.split('\n');
console.log(`  gomoku.html: ${hlines.length} 行 / ${(Buffer.byteLength(html, 'utf8') / 1024).toFixed(1)}KB`);
const inl = /<script>([\s\S]*?)<\/script>/.exec(html)[1];
console.log(`  内联脚本: ${inl.split('\n').length} 行 / ${(Buffer.byteLength(inl, 'utf8') / 1024).toFixed(1)}KB`);
/* 粗略统计内联脚本里各功能段的规模 */
const sections = [
  ['在线对战/WebRTC/聊天', /function\s+onlineConnect/, /function\s+finishOnlineGuess|function\s+openOnlineGuess/],
];
console.log(`  引擎模块: ${(fs.statSync(ENGINE).size / 1024).toFixed(1)}KB`);

console.log('\n===== 7. 引擎内部仍存在的硬编码/隐患 =====');
console.log('  historyTable 下标硬编码 19:', /\*\s*19\s*\+/.test(src) ? '仍存在（棋盘 >19 路会越界）' : '已修');
console.log('  置换表条目满时整体清空:', /ttMap\.clear\(\)/.test(src) ? '仍存在（丢失整局缓存）' : '已修');
console.log('  Zobrist 位数:', /0xFFFFFFFF/.test(src) ? '32 位（碰撞率偏高）' : '未知');
console.log('  是否有必胜距离(ply)编码:', /WIN_SCORE\s*-\s*depth|WIN_SCORE\s*-\s*ply/.test(src) ? '有' : '无（早赢/晚输无偏好）');
console.log('  是否有静态搜索(quiescence):', /quiescence|quiesce/i.test(src) ? '有' : '无');
