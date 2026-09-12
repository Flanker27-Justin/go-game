const fs = require('fs');
const p = 'work/fix-parts/part1.txt';
let cur = fs.readFileSync(p, 'utf8');
const blocks = [
  [' * 检查以 (r, c) 为最后一子是否形成五连\uFFFD? * @returns {Array|null} 整条连线的坐标数组（供高亮绘制），没有则返回 null\uFFFD? */', ' * 检查以 (r, c) 为最后一子是否形成五连。\n * @returns {Array|null} 整条连线的坐标数组（供高亮绘制），没有则返回 null。 */'],
  ['    // 以落子点为中心，沿当前方向向两端延伸，收集同色棋\uFFFD?    const line = [[r, c]];', '    // 以落子点为中心，沿当前方向向两端延伸，收集同色棋子\n    const line = [[r, c]];'],
  [' * 七、绘制（数据 \uFFFD?画面\uFFFD? * 说明：每次全量重绘，只读 board 与少量状态，保证画面与数据永远一致\uFFFD? * ============================================================ */', ' * 七、绘制（数据 → 画面）\n * 说明：每次全量重绘，只读 board 与少量状态，保证画面与数据永远一致。\n * ============================================================ */'],
  ['  drawStones();     // 所有棋\uFFFD?  drawLastMove();   // 最后一步标记（小红点）', '  drawStones();     // 所有棋子\n  drawLastMove();   // 最后一步标记（小红点）'],
  ['  drawTeaching();   // 教学模式：玩家棋型高\uFFFD?+ AI 危险点闪\uFFFD?  drawHint();       // 教育模式推荐点（半透明圆圈\uFFFD?  updateTeachBlink(); // 按需启动/停止危险点闪烁动\uFFFD?}', '  drawTeaching();   // 教学模式：玩家棋型高亮 + AI 危险点闪烁\n  drawHint();       // 教育模式推荐点（半透明圆圈）\n  updateTeachBlink(); // 按需启动/停止危险点闪烁动画\n}'],
  ['  // 网格：横、竖\uFFFD?boardSize 条线', '  // 网格：横、竖各 boardSize 条线'],
  ['  // 星位：天\uFFFD?+ 四角星。公式保\uFFFD?13/15/19 路都能落在标准位\uFFFD?  const center = (boardSize - 1) / 2;', '  // 星位：天元 + 四角星。公式保证 13/15/19 路都能落在标准位置\n  const center = (boardSize - 1) / 2;'],
  ['/** 绘制全部棋子：黑子深色实心，白子浅色带描\uFFFD?*/', '/** 绘制全部棋子：黑子深色实心，白子浅色带描边 */'],
  ['/** 用红线连接获胜五子，结果一目了\uFFFD?*/', '/** 用红线连接获胜五子，结果一目了然 */'],
  ['/** 教学模式绘制层：高亮玩家最后一步的棋型线，并闪\uFFFD?AI 下一步可成五的危险点 */', '/** 教学模式绘制层：高亮玩家最后一步的棋型线，并闪烁 AI 下一步可成五的危险点 */'],
];
for (const [o, n] of blocks) {
  cur += '=====OLD-BLOCK=====\n' + o + '\n=====NEW-BLOCK=====\n' + n + '\n=====END-BLOCK=====\n';
}
fs.writeFileSync(p, cur, 'utf8');
console.log('total blocks:', (cur.match(/=====OLD-BLOCK=====/g) || []).length);
