const fs = require('fs');
const p = 'work/fix-parts/part1.txt';
const cur = fs.readFileSync(p, 'utf8');
const blocks = [
  ['/** 按当前棋盘格数重设画布宽高（19 路最大，\uFFFD?760px\uFFFD?*/', '/** 按当前棋盘格数重设画布宽高（19 路最大，约 760px） */'],
  ['  btnFlipCoin.disabled = true;          // 掷硬\uFFFD?猜奇偶都只有一次机\uFFFD?  btnGuessOdd.disabled = true;', '  btnFlipCoin.disabled = true;          // 掷硬币/猜奇偶都只有一次机会\n  btnGuessOdd.disabled = true;'],
  ['  const guesserName = gameMode === MODE_PVE ? \'\uFFFD? : \'玩家1\';', '  const guesserName = gameMode === MODE_PVE ? \'你\' : \'玩家1\';'],
  ['    // AI 赢得猜先：自动选黑先行，玩家执白（无需手动选择\uFFFD?    guessState.winnerBlack = true;', '    // AI 赢得猜先：自动选黑先行，玩家执白（无需手动选择）\n    guessState.winnerBlack = true;'],
  ['    guessPickTextEl.textContent = \'AI 赢得了猜先，选择执黑先行。你将执白\uFFFD?;', '    guessPickTextEl.textContent = \'AI 赢得了猜先，选择执黑先行。你将执白。\';'],
  ['    guessPickTextEl.textContent = winName + \' 赢得了猜先！请选择执子\uFFFD?;', '    guessPickTextEl.textContent = winName + \' 赢得了猜先！请选择执子：\';'],
  [' * 应用猜先结果\uFFFD? * @param {boolean|null} pickBlack true=赢家执黑 false=赢家执白 null=使用 AI 自动选择的结\uFFFD? * 人机模式\uFFFD?playerColor/aiColor；双人模式写 p1Color（玩\uFFFD? 取相反颜色）\uFFFD? */', ' * 应用猜先结果。\n * @param {boolean|null} pickBlack true=赢家执黑 false=赢家执白 null=使用 AI 自动选择的结果\n * 人机模式写 playerColor/aiColor；双人模式写 p1Color（玩家2 取相反颜色）。 */'],
  ['  // 玩家选执\uFFFD?\uFFFD?AI 执黑先行，先调度 AI 首步', '  // 玩家选执白 → AI 执黑先行，先调度 AI 首步'],
  ['  // 教育模式下按新的玩家颜色刷新推荐点与危险点高\uFFFD?  if (eduMode && gameMode === MODE_PVE && currentPlayer === playerColor && !gameOver) {', '  // 教育模式下按新的玩家颜色刷新推荐点与危险点高亮\n  if (eduMode && gameMode === MODE_PVE && currentPlayer === playerColor && !gameOver) {'],
  [' * 六、胜负判\uFFFD? * 说明：只检查“刚落的子”是否成五——能成五的连线必然穿过它\uFFFD? * ============================================================ */', ' * 六、胜负判定\n * 说明：只检查“刚落的子”是否成五——能成五的连线必然穿过它。\n * ============================================================ */'],
];
let out = cur;
for (const [o, n] of blocks) {
  out += '=====OLD-BLOCK=====\n' + o + '\n=====NEW-BLOCK=====\n' + n + '\n=====END-BLOCK=====\n';
}
fs.writeFileSync(p, out, 'utf8');
console.log('part1 blocks now:', (out.match(/=====OLD-BLOCK=====/g) || []).length);
