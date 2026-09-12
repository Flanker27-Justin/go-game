const fs = require('fs');
// 输出所有包含 FFFD 的行号 + 每行 FFFD 数量 + 上下文（前一/后一行），供最终核对
const lines = fs.readFileSync('_fixed.html', 'utf8').split(/\r?\n/);
const out = [];
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('\uFFFD')) {
    out.push(`${i + 1}\t${(lines[i].match(/\uFFFD/g) || []).length}\t${lines[i].slice(0, 80)}`);
  }
}
fs.writeFileSync('_bad-summary.txt', out.join('\n'), 'utf8');
console.log('bad lines:', out.length);
