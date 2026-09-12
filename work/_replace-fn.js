// 顶层函数替换工具（开发期辅助）
// 用法: node work/_replace-fn.js <目标文件> <函数名> <新函数体文件>
// 行为: 定位 "^function <函数名>(" 到其后花括号配平的顶格 "}"，整段替换为新文件内容。
//       若新内容以 /** 开头，则连同其上方紧邻的连续注释块一起替换（JSDoc 归位）。
// 说明: 配平计数在"剥离注释与字符串"的副本上进行，避免注释里的花括号干扰。
'use strict';
const fs = require('fs');

const [file, fnName, bodyFile] = process.argv.slice(2);
if (!file || !fnName || !bodyFile) {
  console.error('用法: node work/_replace-fn.js <文件> <函数名> <新函数体文件>');
  process.exit(2);
}
const src = fs.readFileSync(file, 'utf8');
const lines = src.split('\n');

/** 把注释/字符串替换成等长空格，便于安全数花括号 */
function blankOut(text) {
  const out = text.split('');
  const n = text.length;
  let i = 0;
  const keep = (a, b) => { for (let k = a; k < b; k++) if (out[k] !== '\n') out[k] = ' '; };
  while (i < n) {
    const c = text[i], d = text[i + 1];
    if (c === '/' && d === '/') { let j = i; while (j < n && text[j] !== '\n') j++; keep(i, j); i = j; continue; }
    if (c === '/' && d === '*') { let j = i + 2; while (j < n && !(text[j] === '*' && text[j + 1] === '/')) j++; keep(i, Math.min(j + 2, n)); i = j + 2; continue; }
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < n && text[j] !== c) { if (text[j] === '\\') j++; j++; }
      keep(i, Math.min(j + 1, n)); i = j + 1; continue;
    }
    i++;
  }
  return out.join('');
}
const cleanLines = blankOut(src).split('\n');

const head = 'function ' + fnName + '(';
let start = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].startsWith(head)) { start = i; break; }
}
if (start < 0) throw new Error('未找到函数 ' + fnName);

let depth = 0, end = -1, seenBrace = false;
for (let i = start; i < cleanLines.length; i++) {
  for (const ch of cleanLines[i]) {
    if (ch === '{') { depth++; seenBrace = true; }
    else if (ch === '}') { depth--; }
  }
  if (seenBrace && depth === 0) { end = i; break; }
}
if (end < 0) throw new Error('函数体未配平: ' + fnName);

const body = fs.readFileSync(bodyFile, 'utf8').replace(/\s+$/, '');
const bodyStartsWithDoc = body.trimStart().startsWith('/**');
let from = start;
if (bodyStartsWithDoc) {
  while (from > 0 && /^\s*(\*|\/\*|\/\/)/.test(lines[from - 1])) from--;
}
const out = lines.slice(0, from).concat(body.split('\n'), lines.slice(end + 1)).join('\n');
fs.writeFileSync(file, out, 'utf8');
console.log(`已替换 ${fnName}: 行 ${from + 1}~${end + 1}（${end - from + 1} 行）→ ${body.split('\n').length} 行`);
