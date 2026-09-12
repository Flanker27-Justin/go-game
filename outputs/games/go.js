/* ============================================================
 * 围棋（开发中）——预留骨架
 * ------------------------------------------------------------
 * 本文件已注册为可切换的游戏，目前只显示占位提示。
 * 开发清单（按顺序实现后即可替换占位逻辑）：
 *   1. 棋盘绘制：9/13/19 路网格 + 星位 + 坐标
 *   2. 落子与提子：气（Liberty）、打吃、提子、禁着点（劫）
 *   3. 终局与计地：贴目规则、死活判断（可先用简易规则）
 *   4. AI：先实现单步启发式（吃子/做活/占大场），再升级搜索
 *   5. 教学点评：提示当前手的大场/急所（可选）
 * ============================================================ */
(function () {
  'use strict';

  // 未运行在五子棋框架（gomoku.html）中时直接退出，避免报错
  if (typeof registerGame !== 'function') return;

  registerGame('go', {
    id: 'go',
    name: '围棋',
    modes: ['pvp', 'pve'],
    boardSizes: [9, 13, 19],  // 围棋标准路数，框架会自动生成下拉选项
    defaultBoardSize: 19,
    aiLevels: null,           // TODO: AI 实现后提供难度表
    supportsEdu: false,       // TODO: 实现教学点评后改为 true

    /** 切到本游戏：画占位提示并禁用框架控件 */
    onEnter() {
      statusEl.textContent = '围棋（开发中）：请选择其他游戏或等待后续版本。';
      setFrameworkControlsEnabled(false);
      drawStubPlaceholder('围棋', '9 / 13 / 19 路棋盘 · 开发中');
    },

    onExit() {},                 // TODO: 清理工作（目前无定时器）

    /** 画布点击：TODO 实现落子与提子 */
    onCanvasClick() {
      statusEl.textContent = '围棋尚未实现落子，敬请期待。';
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
