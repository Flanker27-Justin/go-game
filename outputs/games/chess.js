/* ============================================================
 * 国际象棋（开发中）——预留骨架
 * ------------------------------------------------------------
 * 本文件已注册为可切换的游戏，目前只显示占位提示。
 * 开发清单（按顺序实现后即可替换占位逻辑）：
 *   1. 棋盘绘制：8×8 黑白相间方格 + 棋子（Unicode 字符或图片）
 *   2. 走子规则：马走日、象走斜、车走直线、后/王走法、
 *                王车易位、吃过路兵、兵升变
 *   3. 胜负判定：将军（Check）、将死（Checkmate）、逼和（Stalemate）
 *   4. AI：局面评估（子力 + 位置 + 机动性）+ 搜索
 *   5. 教学点评：对玩家走法给出建议（可选）
 * ============================================================ */
(function () {
  'use strict';

  // 未运行在五子棋框架（gomoku.html）中时直接退出，避免报错
  if (typeof registerGame !== 'function') return;

  registerGame('chess', {
    id: 'chess',
    name: '国际象棋',
    modes: ['pvp', 'pve'],
    boardSizes: null,      // 国际象棋固定 8×8，不支持格数切换
    aiLevels: null,        // TODO: AI 实现后提供难度表
    supportsEdu: false,    // TODO: 实现教学点评后改为 true

    /** 切到本游戏：画占位提示并禁用框架控件 */
    onEnter() {
      statusEl.textContent = '国际象棋（开发中）：请选择其他游戏或等待后续版本。';
      setFrameworkControlsEnabled(false);
      drawStubPlaceholder('国际象棋', '8×8 棋盘 · 开发中');
    },

    onExit() {},                 // TODO: 清理工作（目前无定时器）

    /** 画布点击：TODO 实现走子 */
    onCanvasClick() {
      statusEl.textContent = '国际象棋尚未实现走子，敬请期待。';
    },
  });

  /**
   * 在画布中央绘制占位提示。
   * canvas / ctx 是 gomoku.html 提供的框架全局对象。
   */
  function drawStubPlaceholder(title, subtitle) {
    const w = canvas.width, h = canvas.height;
    ctx.fillStyle = '#f2ead9';
    ctx.fillRect(0, 0, w, h);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#5a3d1a';
    ctx.font = 'bold 30px "Microsoft YaHei", sans-serif';
    ctx.fillText(title, w / 2, h / 2 - 30);
    ctx.font = '16px "Microsoft YaHei", sans-serif';
    ctx.fillText(subtitle, w / 2, h / 2 + 8);
    ctx.fillText('接口已预留：实现后在此替换占位逻辑即可', w / 2, h / 2 + 36);
  }
})();
