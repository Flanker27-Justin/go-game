const fs = require('fs');
const bad = JSON.parse(fs.readFileSync('work/bad-lines.json', 'utf8'));
for (const n of [1406, 1517, 1527, 1537, 1546, 1547, 1551, 1556, 1570, 1571, 1580]) {
  console.log(`L${n}: ${bad[n].replace(/\uFFFD/g, '\\uFFFD')}`);
}
