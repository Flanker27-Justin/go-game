/* ============================================================
 * GameAdapter 接口模板（开发新游戏用）
 * ------------------------------------------------------------
 * 使用方法：
 *   1) 复制本文件为 games/你的游戏.js（例如 games/chess.js）；
 *   2) 按下方 TODO 逐项实现；
 *   3) 在 outputs/gomoku.html 末尾加一行：
 *        <script src="games/你的游戏.js"></script>
 *      框架会自动把它加入页面左上角“游戏”下拉框。
 *
 * 可用环境：
 *   - 框架全局对象：registerGame / switchGame / getActiveGame
 *   - 画布与状态：canvas / ctx / statusEl（由 gomoku.html 提供）
 *   - 常量：EMPTY=0 / BLACK=1 / WHITE=2 / MODE_PVP / MODE_PVE
 *
 * 字段说明（可省略的字段省略即可，框架会按能力显隐界面控件）：
 *   id / name            必填：唯一标识、界面显示名
 *   modes                支持的模式数组，如 ['pvp', 'pve']
 *   boardSizes           可选格数数组；null 表示固定棋盘
 *   defaultBoardSize     默认格数
 *   aiLevels             AI 难度表 { easy:'简单', ... }；null 表示暂无 AI
 *   defaultAiLevel       默认难度
 *   supportsEdu          是否支持教学点评
 *   onEnter()            切到本游戏时调用（初始化 + 首帧绘制）
 *   onExit()             切走时清理（定时器、临时监听器等）
 *   onCanvasClick(e)     画布点击（e 为原生事件对象）
 *   onUndo()/onRestart() 悔棋 / 重新开始
 *   onModeChange(mode)   双人 / 人机切换
 *   onBoardSizeChange(n) 棋盘格数变化
 *   onAiLevelChange(lv)  AI 难度变化
 *   onEduToggle(ok)      教学点评开关（可选）
 *   onHintToggle(ok)     推荐点开关（可选）
 * ============================================================ */
(function () {
  'use strict';

  // 未运行在五子棋框架（gomoku.html）中时直接退出，避免报错
  if (typeof registerGame !== 'function') return;

  registerGame('your-game-id', {
    id: 'your-game-id',
    name: '你的游戏',
    modes: ['pvp', 'pve'],
    boardSizes: null,                 // TODO: 例如围棋 [9, 13, 19]
    defaultBoardSize: 15,             // TODO: 默认格数
    aiLevels: null,                   // TODO: 例如 { easy: '简单', hard: '困难' }
    defaultAiLevel: 'medium',
    supportsEdu: false,               // TODO: 实现教学点评后改为 true

    /** 切到本游戏时调用：重置状态、重绘画布、刷新状态栏 */
    onEnter() {
      // TODO: 初始化棋盘数据、绘制第一帧
      statusEl.textContent = this.name + '（开发中）';
    },

    /** 切走时调用：取消定时器、移除临时监听器 */
    onExit() {
      // TODO: 清理工作
    },

    /** 画布点击：把坐标换算成自己的格子后执行走子逻辑 */
    onCanvasClick(e) {
      // TODO: 实现走子规则
    },

    /** 悔棋 */
    onUndo() {
      // TODO: 实现悔棋
    },

    /** 重新开始 */
    onRestart() {
      this.onEnter();
    },

    /** 双人 / 人机切换 */
    onModeChange(mode) {
      // TODO: 按模式调整流程（人机时轮到 AI 自动落子）
    },

    /** 棋盘格数变化 */
    onBoardSizeChange(size) {
      // TODO: 按新格数重开一局
    },

    /** AI 难度变化 */
    onAiLevelChange(level) {
      // TODO: 记录难度，影响后续 AI 决策
    },

    /** 教学点评开关 */
    onEduToggle(checked) {
      // TODO: 实现点评逻辑
    },

    /** 推荐点开关 */
    onHintToggle(checked) {
      // TODO: 实现推荐点绘制
    },
  });
})();
