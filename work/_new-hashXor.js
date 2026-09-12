/** 把 (r,c) 处的 color 棋从 64 位棋盘哈希中异或进/出（落子与悔棋各调用一次） */
function hashXor(r, c, color) {
  if (!ttZobrist) return;
  const z = ttZobrist[r][c];
  const o = color === BLACK ? 0 : 2;
  boardHashLo ^= z[o];
  boardHashHi ^= z[o + 1];
  boardHash = boardHashLo >>> 0;
}

/** 置换表键：64 位棋盘哈希 + 行棋方混合成 53 位安全整数（同时含"轮到谁"信息） */
function ttKeyOf(color) {
  const hi = (boardHashHi ^ (color === BLACK ? TT_PERSP_BLACK : TT_PERSP_WHITE)) >>> 0;
  const lo = (boardHashLo ^ (color === BLACK ? TT_SIDE_ME : TT_SIDE_OPP)) >>> 0;
  return hi * 2097152 + (lo >>> 11);
}
