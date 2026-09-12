const fs = require('fs');
let fixed = fs.readFileSync('_fixed.html', 'utf8');
let corrupt = fs.readFileSync('outputs/gomoku.html', 'utf8');
fixed = fixed.replace(/^\uFEFF/, '').replace(/^\?/, '');
corrupt = corrupt.replace(/^\uFEFF/, '');
function seq(s) { return s.replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, ''); }
function seqNoQ(s) { return s.replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, '').replace(/\?/g, ''); }
const a = seq(fixed);
const b = seq(corrupt);
const aNQ = seqNoQ(fixed);
const bNQ = seqNoQ(corrupt);
console.log('fixed q count:', (a.match(/\?/g)||[]).length);
console.log('corrupt q count:', (b.match(/\?/g)||[]).length);
console.log('fixed noQ len:', aNQ.length, 'corrupt noQ len:', bNQ.length);
console.log('noQ equal:', aNQ === bNQ);
if (aNQ !== bNQ) {
  let i = 0;
  while (i < aNQ.length && i < bNQ.length && aNQ[i] === bNQ[i]) i++;
  console.log('first noQ diff at', i);
  console.log('fixed  ctx:', JSON.stringify(aNQ.slice(Math.max(0,i-80), i+80)));
  console.log('corrupt ctx:', JSON.stringify(bNQ.slice(Math.max(0,i-80), i+80)));
}
