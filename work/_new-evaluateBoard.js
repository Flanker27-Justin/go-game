/**
 * 局面评估：己方全部棋型分 − 对方全部棋型分×1.1，另加连接性、中心权重、
 * 双威胁组合分与“威胁空间”分。
 * 强度改造（P0）：全部改为读增量表（O(1)），替代旧实现每个叶节点的
 * “全盘 361×4 次 lineInfo + 128 次 countThreats + 双方各 48 次 threatLevel”。
 * 数值口径与旧实现一致：
 *   lineSum  各色连线棋型分之和（按连续段起点计一次）
 *   adjSum   四邻同色连接数之和        posSum  中心权重之和
 *   dblCnt   一手双威胁点数            spaceSum 威胁空间加权和
 * @param {number} [comboWeight] 双威胁/威胁空间分的折扣系数：AI 决策用 1；
 *        胜率估算用 0.25，避免“双三/活三延伸”这类强而不必胜的棋型把胜率推过高。
 */
function evaluateBoard(me = aiColor, opp = playerColor, comboWeight = 1, tempoFor = null) {
  if (!evalReady) ensureEvalState();
  const aiScore = lineSum[me] + adjSum[me] * CONNECT_BONUS + posSum[me] * CENTER_WEIGHT
                + (dblCnt[me] * DOUBLE_THREAT_BONUS + spaceSum[me]) * comboWeight;
  const playerScore = lineSum[opp] + adjSum[opp] * CONNECT_BONUS + posSum[opp] * CENTER_WEIGHT
                + (dblCnt[opp] * DOUBLE_THREAT_BONUS + spaceSum[opp]) * comboWeight;
  // 防守权重略高（1.1）：让 AI 攻防取舍时稍微偏保守（与旧实现一致）。
  // 先手权（tempo）修正：轮到谁走谁有先行展开权，同一局面下先手方评估更高。
  const raw = aiScore - playerScore * 1.1;
  if (tempoFor === me) return raw + TEMPO_BONUS;
  if (tempoFor === opp) return raw - TEMPO_BONUS;
  return raw;
}
