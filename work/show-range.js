const fs = require('fs');
const bad = JSON.parse(fs.readFileSync('work/bad-lines.json', 'utf8'));
const nums = Object.keys(bad).map(Number).sort((a,b)=>a-b);
for (const n of nums) {
  if (n >= 2423 && n <= 2600) console.log(`L${n}: ${bad[n]}`);
}
