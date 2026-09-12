const fs = require('fs');
const lines = fs.readFileSync('_fixed.html', 'utf8').split(/\r?\n/);
const bad = [];
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('\uFFFD')) bad.push({ n: i + 1, line: lines[i] });
}
console.log('bad lines:', bad.length);
for (const b of bad) {
  console.log(`--- L${b.n} ---`);
  console.log(b.line);
}
fs.writeFileSync('_remaining-bad.txt', bad.map(b => `--- L${b.n} ---\n${b.line}`).join('\n'), 'utf8');
