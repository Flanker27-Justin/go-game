/* ============================================================
 * 中国象棋（开发中）——预留骨架
 * ------------------------------------------------------------
 * 本文件已注册为可切换的游戏，目前只显示占位提示。
 * 开发清单（按顺序实现后即可替换占位逻辑）：
 *   1. 棋盘绘制：9 列 × 10 行，楚河汉界 + 九宫斜线 + 棋子
 *   2. 走子规则：车/马/炮/相/士/帅/兵的走法、蹩马腿、塞象眼、
 *                炮隔子吃、将帅不能照面
 *   3. 胜负判定：将死、困毙、长将判和（可先做简单判定）
 *   4. AI：局面评估（子力价值 + 位置价值）+ 搜索
 *   5. 教学点评：提示当前局面要点（可选）
 * ============================================================ */
(function () {
  'use strict';

  // 未运行在五子棋框架（gomoku.html）中时直接退出，避免报错
  if (typeof registerGame !== 'function') return;

  registerGame('chinese-chess', {
    id: 'chinese-chess',
    name: '中国象棋',
    modes: ['pvp', 'pve'],
    boardSizes: null,      // 中国象棋固定 9×10，不支持格数切换
    aiLevels: null,        // TODO: AI 实现后提供难度表
    supportsEdu: false,    // TODO: 实现教学点评后改为 true

    /** 切到本游戏：画占位提示并禁用框架控件 */
    onEnter() {
      statusEl.textContent = '中国象棋（开发中）：请选择其他游戏或等待后续版本。';
      setFrameworkControlsEnabled(false);
      drawStubPlaceholder('中国象棋', '9 列 × 10 行 · 楚河汉界 · 开发中');
    },

    onExit() {},                 // TODO: 清理工作（目前无定时器）

    /** 画布点击：TODO 实现走子 */
    onCanvasClick() {
      statusEl.textContent = '中国象棋尚未实现走子，敬请期待。';
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
