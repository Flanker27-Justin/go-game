// 必杀题库校验：work/positions.json 里每个局面都要求引擎给出「可接受的应手」，
// 且不得落在「已知错误应手」上。这是改动 AI 后最快的回归体检。
//
// 设计说明：题库只收录“战术上有唯一/有限正解”的局面（挡活三、挡冲四、抢双三点、
// 一步成五、VCF 防守…）。对“无法强断言”的局面，good 用较宽的集合，bad 留空。
//
// 用法: node work/positions-test.js [--verbose]
'use strict';
const fs = require('fs');
const path = require('path');
const A = require(path.join(__dirname, '..', 'outputs', 'engine', 'gomoku-ai.js'));
const S = 19;
const { EMPTY, BLACK, WHITE } = A;

const lib = JSON.parse(fs.readFileSync(path.join(__dirname, 'positions.json'), 'utf8'));
const VERBOSE = process.argv.includes('--verbose');

A.setMoveVariety(0);   // 关闭随机，保证可复现

const key = (rr, cc) => rr * S + cc;
let pass = 0, fail = 0;
const failures = [];

function checkPosition(pos) {
  const level = pos.level || 'medium';
  /* 建盘 */
  A.setBoardSize(S);
  const b = A.board;
  for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) b[r][c] = EMPTY;
  const counts = { 1: 0, 2: 0 };
  for (const [colorStr, cells] of Object.entries(pos.stones)) {
    const color = Number(colorStr);
    for (const [r, c] of cells) {
      if (r < 0 || r >= S || c < 0 || c >= S) throw new Error(`${pos.id}: 坐标越界 ${r},${c}`);
      if (b[r][c] !== EMPTY) throw new Error(`${pos.id}: 坐标冲突 ${r},${c}`);
      b[r][c] = color;
      counts[color]++;
    }
  }
  /* 合法性校验（注意：题库是“人为构造的孤立战术局面”，不必来自合法对局，
   * 因此不检查黑白子数差；只检查坐标有效、不冲突、且局面里没有已经连成五的一方）
   * ——已连成五的局面用 id 前缀 long-connect / win- 标记，跳过后面的成五检查。 */
  const hasFiveAlready = (() => {
    for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) {
      const color = b[r][c];
      if (color === EMPTY) continue;
      for (const [dr, dc] of A.DIRECTIONS) {
        let n = 1;
        for (const k of [1, -1]) for (let i = 1; i < 5; i++) {
          const rr = r + dr * i * k, cc = c + dc * i * k;
          if (rr < 0 || rr >= S || cc < 0 || cc >= S || b[rr][cc] !== color) break;
          n++;
        }
        if (n >= 5) return color;
      }
    }
    return 0;
  })();
  const allowFinished = /^(long-connect|win-)/.test(pos.id);
  if (hasFiveAlready && !allowFinished) {
    throw new Error(`${pos.id}: 局面里已有五连（颜色 ${hasFiveAlready}），战术断言无意义`);
  }
  A.setColors(pos.turn === BLACK ? WHITE : BLACK, pos.turn);   // aiColor = 行动方

  const goodKeys = new Set((pos.good || []).map(([r, c]) => key(r, c)));
  const badKeys = new Set((pos.bad || []).map(([r, c]) => key(r, c)));

  const t0 = Date.now();
  const mv = A.getBestMove(level, pos.turn);
  const ms = Date.now() - t0;

  const label = `${pos.id} [${level}] ${pos.note || ''}`;
  if (!mv) {
    fail++; failures.push(`${pos.id}: 未返回落点（期望 ${pos.good.length ? JSON.stringify(pos.good) : '任意'}）`);
    return;
  }
  const [r, c] = mv;
  if (b[r][c] !== EMPTY) {
    fail++; failures.push(`${pos.id}: 落在已有棋子的位置 ${r},${c}`);
    return;
  }
  const k = key(r, c);
  const isGood = goodKeys.size === 0 || goodKeys.has(k);
  const isBad = badKeys.has(k);
  if (isGood && !isBad) {
    pass++;
    if (VERBOSE) console.log(`  ✓ ${label} → (${r},${c}) ${ms}ms`);
  } else {
    fail++;
    failures.push(`${pos.id}: 落点 (${r},${c}) ${isBad ? '属于已知错误应手' : '不在可接受集合'}；可接受=${JSON.stringify(pos.good)}${pos.bad.length ? ' 禁忌=' + JSON.stringify(pos.bad) : ''}`);
  }
}

console.log(`==== 必杀题库校验（${lib.positions.length} 个局面）====`);
const t0 = Date.now();
for (const pos of lib.positions) {
  try { checkPosition(pos); }
  catch (e) { fail++; failures.push(pos.id + ': ' + e.message); }
}
console.log(`通过 ${pass} / 失败 ${fail}，耗时 ${Date.now() - t0}ms`);
if (failures.length) {
  console.log('\n失败明细:');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log('题库全部通过：引擎在全部关键战术局面下都给出可接受应手');
