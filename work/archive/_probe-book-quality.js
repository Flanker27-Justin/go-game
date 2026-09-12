// 检查开局库的规模、覆盖与“白方应答”的质量分布
'use strict';
const path = require('path');
const book = require(path.join(__dirname, '..', 'outputs', 'engine', 'opening-book.json'));
const keys = Object.keys(book);
const entries = Object.values(book).reduce((n, v) => n + v.length, 0);

console.log('==== 开局库概况 ====');
console.log('键数:', keys.length, ' 应答总数:', entries);
const wKeys = keys.filter(k => k.startsWith('W|'));
const bKeys = keys.filter(k => k.startsWith('B|'));
console.log('轮到白(W|)的键:', wKeys.length, '  轮到黑(B|)的键:', bKeys.length);

/* 按“盘面子数”统计覆盖：键里用 ';' 分隔棋子 */
const byStones = {};
for (const k of keys) {
  const body = k.slice(2);
  const n = body === '' ? 0 : body.split(';').length;
  byStones[n] = (byStones[n] || 0) + 1;
}
console.log('\n按盘面子数的键覆盖:');
for (const n of Object.keys(byStones).sort((a, b) => a - b)) {
  console.log(`  ${n} 子: ${byStones[n]} 个键`);
}

console.log('\n白方在“黑占天元”后的应答选项:');
console.log(' ', JSON.stringify(book['W|0,0,1']));

console.log('\n随机抽样 6 个白方键及其应答:');
const sample = wKeys.filter((_, i) => i % Math.max(1, Math.floor(wKeys.length / 6)) === 0).slice(0, 6);
for (const k of sample) console.log(`  ${k.padEnd(46)} → ${JSON.stringify(book[k])}`);

/* 关键：应答里权重最高的那一手，是否常常是“贴着自己棋子展开”而不是纯堵点？ */
console.log('\n==== 应答“相对天元”的分布（权重最高的第一应答）====');
const dist = {};
for (const k of keys) {
  const first = book[k][0];
  if (!first) continue;
  const [x, y, wt] = first;
  const d = Math.abs(x) + Math.abs(y);
  dist[d] = (dist[d] || 0) + 1;
}
for (const d of Object.keys(dist).sort((a, b) => a - b)) {
  console.log(`  曼哈顿距离 ${d} 格: ${dist[d]} 次`);
}

/* 统计“白方首应”之后的走向：模拟黑天元 → 白应 → 黑第二手，看白第三手有多少选择 */
console.log('\n==== 一条典型开局主线（按库内最高权重）====');
const center = 9;
function normKey(side, stones) {
  // stones: 相对天元的 [x,y,color]
  const pts = stones.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  return side + '|' + pts.map(p => p.join(',')).join(';');
}
let line = [{ x: 0, y: 0, color: 1 }];
const trace = ['黑(9,9)'];
for (let ply = 1; ply <= 6; ply++) {
  const side = ply % 2 === 1 ? 'W' : 'B';
  /* 需要 8 对称规范化：这里用简化版（只做恒等），够用来看走向 */
  const key = normKey(side, line);
  const e = book[key];
  if (!e) { trace.push(`${side}:(无库)`); break; }
  const [x, y] = e[0];
  line.push({ x, y, color: side === 'W' ? 2 : 1 });
  trace.push(`${side === 'W' ? '白' : '黑'}(${center + x},${center + y})`);
}
console.log('  ' + trace.join(' → '));
