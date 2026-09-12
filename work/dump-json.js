const fs = require('fs');
const lines = fs.readFileSync('_fixed.html', 'utf8').split(/\r?\n/);
const bad = {};
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('\uFFFD')) bad[i + 1] = lines[i];
}
fs.writeFileSync('work/bad-lines.json', JSON.stringify(bad, null, 1), 'utf8');
console.log('written', Object.keys(bad).length);
