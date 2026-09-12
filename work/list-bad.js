const fs = require('fs');
const lines = fs.readFileSync('_fixed.html', 'utf8').split(/\r?\n/);
const bad = [];
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('\uFFFD')) bad.push(i + 1);
}
console.log(bad.join(','));
