const fs = require('fs');
const path = require('path');
// 解析 part 文件：=====OLD-BLOCK===== ... =====NEW-BLOCK===== ... =====END-BLOCK=====
function parsePart(file) {
  const text = fs.readFileSync(file, 'utf8');
  const blocks = [];
  const re = /=====OLD-BLOCK=====\n([\s\S]*?)\n=====NEW-BLOCK=====\n([\s\S]*?)\n=====END-BLOCK=====/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    let oldL = m[1].replace(/\\uFFFD/g, '\uFFFD'); // 把转义序列还原为真实 U+FFFD
    // 还原后行尾若含 ? 标记保持原样
    blocks.push({ old: oldL, neu: m[2] });
  }
  return blocks;
}
const dir = path.join(__dirname, 'fix-parts');
const parts = fs.readdirSync(dir).filter(f => f.endsWith('.txt')).sort();
const FIX = new Map();
for (const p of parts) {
  for (const b of parsePart(path.join(dir, p))) FIX.set(b.old, b.neu);
}
const src = fs.readFileSync('_fixed.html', 'utf8');
const lines = src.split('\n');
let applied = 0, missed = 0;
const out = lines.map(l => {
  if (FIX.has(l)) { applied++; return FIX.get(l); }
  return l;
});
for (const [oldL] of FIX) {
  if (!lines.includes(oldL)) { missed++; console.log('MISS:', JSON.stringify(oldL.slice(0, 90))); }
}
console.log('fix entries:', FIX.size, 'applied:', applied, 'missed:', missed);
fs.writeFileSync('_fixed.html', out.join('\n'), 'utf8');
