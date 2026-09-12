// 隔离复现：只做“常量块替换”这一步，检查它是否破坏了注释结构。
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const lines = fs.readFileSync(path.join(ROOT, 'outputs', 'gomoku.html'), 'utf8').split(/\r?\n/);

function findRange(startMarker, endMarker) {
  const s = lines.findIndex(l => l.includes(startMarker));
  let e = -1;
  for (let i = s + 1; i < lines.length; i++) if (lines[i].includes(endMarker)) { e = i; break; }
  return [s, e];
}
const range = findRange(' * 一、常量与配置', ' * 二、全局状态');
console.log('range =', range);
console.log('删除区间首行   :', JSON.stringify(lines[range[0]]));
console.log('删除区间末行   :', JSON.stringify(lines[range[1]]));
console.log('区间行数       :', range[1] - range[0]);
console.log('区间前一行     :', JSON.stringify(lines[range[0] - 1]));
console.log('区间后一行     :', JSON.stringify(lines[range[1] + 1]));
console.log('区间内 /* 数   :', lines.slice(range[0], range[1]).join('\n').split('/*').length - 1);
console.log('区间内 */ 数   :', lines.slice(range[0], range[1]).join('\n').split('*/').length - 1);

const NEW = [
  '/* ============================================================',
  ' * 一、常量与配置',
  ' * 说明：AI 相关常量（搜索参数、棋型分值表、开局库…）已全部移入引擎模块',
  ' *       outputs/engine/gomoku-ai.js；本页只保留页面/对局框架用得到的常量，',
  ' *       与引擎共享的那部分直接从 GomokuAI 取，保证只有一份定义。',
  ' * ============================================================ */',
  '/* 引擎持有的棋盘与状态（唯一数据源）：board / boardSize / playerColor / aiColor',
  ' * / moveVariety / lastVcfPath / lastVctPath / 搜索缓存，全部通过 AI.* 访问。 */',
  'const {',
  '  EMPTY, BLACK, WHITE, DIRECTIONS,',
  '  LEVEL_EASY, LEVEL_MEDIUM, LEVEL_HARD,',
  '  OPENING_TOTAL_MOVES,',
  '} = AI;',
  '',
  "const MODE_PVP = 'pvp';",
  "const MODE_PVE = 'pve';",
  "const MODE_ONLINE = 'online';",
  'const AI_DELAY = 250;',
  '/* AI 默认执白；猜先后由引擎的 aiColor 决定实际执子 */',
  '',
];
const before = lines.slice(range[0] - 1, range[0] + 1).join('\n');
lines.splice(range[0], range[1] - range[0], ...NEW);
console.log('\n--- 替换后：前一行 + 新区块首行 + 原末行 ---');
console.log(lines.slice(range[0] - 1, range[0] + 3).map((l, i) => `${i}: ${JSON.stringify(l)}`).join('\n'));
console.log('\n--- 替换后：新区块末尾之后的 4 行（应看到状态块注释完整）---');
console.log(lines.slice(range[0] + NEW.length - 1, range[0] + NEW.length + 4).map((l, i) => `${i}: ${JSON.stringify(l)}`).join('\n'));
