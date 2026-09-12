/**
 * 初始化搜索加速表（64 位置换表 + 历史启发 + 杀手手）。
 * 每次 bestBySearch 开始时调用：重建棋盘哈希、开新一代置换表（代龄淘汰，
 * 不再整表 clear，跨手积累得以保留）、衰减历史分、清空杀手手。
 * 同时对齐增量评估状态（外部可能直接改写过棋盘）。
 */
function initSearchTables() {
  if (!ttZobrist) {
    // 首次生成 Zobrist 随机底数：每个 (位置, 颜色) 两个 32 位随机整数（64 位哈希）。
    // 按 19×19 固定尺寸；13/15 棋盘只使用左上部分，不影响哈希正确性。
    ttZobrist = [];
    for (let r = 0; r < 19; r++) {
      ttZobrist[r] = [];
      for (let c = 0; c < 19; c++) {
        ttZobrist[r][c] = [
          (Math.random() * 0xFFFFFFFF) | 0, (Math.random() * 0xFFFFFFFF) | 0,
          (Math.random() * 0xFFFFFFFF) | 0, (Math.random() * 0xFFFFFFFF) | 0,
        ];
      }
    }
  }
  if (!ttMap) ttMap = new Map();
  const n = boardSize * boardSize;
  if (!historyTable || historyTable[0].length !== n) {
    historyTable = [new Int32Array(n), new Int32Array(n)];
  } else {
    for (let s = 0; s < 2; s++) {
      const h = historyTable[s];
      for (let i = 0; i < n; i++) if (h[i]) h[i] >>= 1;   // 跨手衰减，避免历史分固化
    }
  }
  if (!killerTable || killerTable.length < 64) {
    killerTable = Array.from({ length: 64 }, () => [-1, -1]);
  } else {
    for (let i = 0; i < killerTable.length; i++) { killerTable[i][0] = -1; killerTable[i][1] = -1; }
  }
  if (!movePool) movePool = new Int32Array(MOVE_POOL_SIZE);
  movePoolPtr = 0;
  // 棋盘哈希按当前棋盘重建（外部可能直接改写过棋盘）
  boardHashLo = 0;
  boardHashHi = 0;
  for (let r = 0; r < boardSize; r++) {
    for (let c = 0; c < boardSize; c++) {
      if (board[r][c] !== EMPTY) hashXor(r, c, board[r][c]);
    }
  }
  boardHash = boardHashLo >>> 0;
  ttGen++;
}
