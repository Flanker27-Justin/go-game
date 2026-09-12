const fs = require('fs');
const lines = fs.readFileSync('_fixed.html', 'utf8').split(/\r?\n/);
const refLines = fs.readFileSync('outputs/gomoku.html.bak-tt', 'utf8').split(/\r?\n/);
function norm(s) {
  // 去掉所有非 ASCII 可见字符、以及 ? （损坏标记/三元运算符），压缩空白
  return s.replace(/[^\x20-\x7E]/g, '').replace(/\?/g, '').replace(/\s+/g, '');
}
const refNorm = refLines.map(r => norm(r));
const bad = [];
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('\uFFFD')) bad.push({ n: i + 1, line: lines[i], nrm: norm(lines[i]) });
}
console.log('bad count:', bad.length);
let matched = 0, unmatched = 0;
const out = [];
for (const b of bad) {
  let found = null;
  for (let j = 0; j < refNorm.length; j++) {
    if (refNorm[j] === b.nrm) { found = refLines[j]; break; }
    // 尝试与参考的连续两行合并匹配
    if (j + 1 < refNorm.length && refNorm[j] + refNorm[j+1] === b.nrm) {
      found = refLines[j] + '\n' + refLines[j+1]; break;
    }
  }
  if (found) {
    matched++;
    out.push(`--- L${b.n} MATCH ---\nFIXED : ${b.line}\nREF   : ${found}`);
  } else {
    unmatched++;
    out.push(`--- L${b.n} NO-MATCH ---\nFIXED : ${b.line}`);
  }
}
console.log('matched:', matched, 'unmatched:', unmatched);
fs.writeFileSync('_match-report.txt', out.join('\n'), 'utf8');
