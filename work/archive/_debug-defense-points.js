// 诊断：criticalDefensePoints 是否收到了“对方双三”点？
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');

/* 把 criticalDefensePoints / tacticalCandidates 暴露出来便于检查 */
let src = fs.readFileSync(path.join(ROOT, 'outputs', 'engine', 'gomoku-ai.js'), 'utf8');
src = src.replace('    /* 决策与查询 */',
  '    criticalDefensePoints, tacticalCandidates,\n    /* 决策与查询 */');
const sandbox = { module: { exports: {} }, console, performance: { now: () => Date.now() }, Math, JSON, Set, Map, Int32Array, Array, Object, Number, String, isNaN, parseInt, parseFloat, Infinity, NaN };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'engine-x.js' });
const A = sandbox.module.exports;
const BLACK = 1, WHITE = 2, EMPTY = 0;
A.setMoveVariety(0);
A.setBoardSize(19);
A.setColors(BLACK, WHITE);   // 白方行动 → aiColor=BLACK, playerColor=WHITE? 需注意
/* 该题：轮到白(2)行动，故把 AI 颜色设为白 */
A.setColors(BLACK, WHITE);
A.setColors(WHITE, BLACK);   // aiColor=WHITE(行动方), playerColor=BLACK

const b = A.board;
for (let r = 0; r < 19; r++) for (let c = 0; c < 19; c++) b[r][c] = EMPTY;
/* 题库局面 block-opponent-double-three-white */
for (const [r, c] of [[10, 5], [10, 6], [8, 7], [9, 7]]) b[r][c] = BLACK;
for (const [r, c] of [[12, 12], [13, 13]]) b[r][c] = WHITE;

console.log('黑: (10,5)(10,6)(8,7)(9,7)   白: (12,12)(13,13)   轮白');
console.log('黑在 (10,7) 落子后:');
b[10][7] = BLACK;
console.log('  横向 lineInfo =', JSON.stringify(A.lineInfo(10, 7, 0, 1, BLACK)));
console.log('  竖向 lineInfo =', JSON.stringify(A.lineInfo(10, 7, 1, 0, BLACK)));
console.log('  countThreats(10,7,黑) =', A.countThreats(10, 7, BLACK));
b[10][7] = EMPTY;
console.log('  findOpponentDoubleThreat(黑) =', JSON.stringify(A.findOpponentDoubleThreat ? A.findOpponentDoubleThreat(BLACK) : 'n/a'));
console.log('  criticalDefensePoints(黑) =', JSON.stringify(A.criticalDefensePoints(BLACK)));
console.log('  其中是否含 (10,7):', A.criticalDefensePoints(BLACK).some(p => p[0] === 10 && p[1] === 7));
console.log('  tacticalCandidates(白,黑) =', JSON.stringify(A.tacticalCandidates(WHITE, BLACK)));
console.log('  白方落点 medium =', JSON.stringify(A.getBestMove('medium', WHITE)));
console.log('  白方落点 hard   =', JSON.stringify(A.getBestMove('hard', WHITE)));
