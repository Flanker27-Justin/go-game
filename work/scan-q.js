const fs = require('fs');
// 检查 _fixed.html 中除 FFFD 外的潜在问题：行首/行尾残留 ? 等
const lines = fs.readFileSync('_fixed.html', 'utf8').split(/\r?\n/);
// 1) 行首多余 ?
for (let i = 0; i < Math.min(5, lines.length); i++) console.log('L' + (i+1), JSON.stringify(lines[i].slice(0, 20)));
// 2) 找所有 ? 不在 FFFD 后面的位置
let suspect = 0;
for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  for (let j = 0; j < l.length; j++) {
    if (l[j] === '?' && (j === 0 || l[j-1] !== '\uFFFD')) {
      // 判断前一个字符是否为中文或标点（可能是损坏残留）
      const prev = j > 0 ? l[j-1] : '';
      if (/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(prev)) {
        suspect++;
        if (suspect <= 30) console.log(`L${i+1} suspect ?:`, JSON.stringify(l.slice(Math.max(0,j-12), j+12)));
      }
    }
  }
}
console.log('suspect ? count:', suspect);
