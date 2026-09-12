const fs = require('fs');
const lines = fs.readFileSync('_fixed.html', 'utf8').split(/\r?\n/);
const line = lines[694]; // L695
const idx = line.indexOf('\uFFFD');
console.log('around L695:', JSON.stringify(line.slice(idx-8, idx+8)));
console.log('code units:', [...line.slice(idx-2, idx+6)].map(c=>c.charCodeAt(0).toString(16)).join(' '));
// 统计 FFFD 前后的字符模式
let fffdFollowQ = 0, fffdOther = 0;
for (const l of lines) {
  for (let i = 0; i < l.length; i++) {
    if (l.charCodeAt(i) === 0xFFFD) {
      const next = l[i+1];
      if (next === '?') fffdFollowQ++; else fffdOther++;
    }
  }
}
console.log('FFFD followed by ?:', fffdFollowQ, 'FFFD other:', fffdOther);
