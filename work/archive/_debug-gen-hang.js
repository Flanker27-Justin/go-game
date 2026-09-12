// 定位生成器卡住的位置
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const MODULE = path.join(ROOT, 'outputs', 'engine', 'gomoku-ai.js');
const src = fs.readFileSync(MODULE, 'utf8');
const lines = src.split(/\r?\n/);
console.log('模块行数:', lines.length, '字节:', src.length);

const MARK = '/* ---------------- 三、引擎实现';
const iFuncs = lines.findIndex(l => l.startsWith(MARK));
console.log('三、引擎实现 标记行:', iFuncs + 1);
const MARK_BOOK = '/* ---------------- 四、开局库';
const iBook = lines.findIndex(l => l.startsWith(MARK_BOOK));
console.log('四、开局库 标记行:', iBook + 1);

const funcsText = lines.slice(iFuncs + 1, iBook).join('\n').trim();
console.log('函数段行数:', funcsText.split('\n').length);
const fnNames = [...funcsText.matchAll(/^function\s+([A-Za-z_$][\w$]*)\s*\(/gm)].map(m => m[1]);
console.log('函数个数:', fnNames.length, '前几个:', fnNames.slice(0, 5).join(', '));

/* 复现 braceEnd 逻辑，逐个函数测试是否死循环 */
function makeScanner(text) {
  const n = text.length;
  let i = 0, state = 'code';
  function step() {
    for (; i < n; i++) {
      const ch = text[i], nxt = text[i + 1];
      if (state === 'code') {
        if (ch === '/' && nxt === '/') { state = 'line-comment'; i++; continue; }
        if (ch === '/' && nxt === '*') { state = 'block-comment'; i++; continue; }
        if (ch === "'") { state = 'single'; continue; }
        if (ch === '"') { state = 'double'; continue; }
        if (ch === '`') { state = 'template'; continue; }
        return ch;
      } else if (state === 'line-comment') { if (ch === '\n') state = 'code'; }
      else if (state === 'block-comment') { if (ch === '*' && nxt === '/') { state = 'code'; i++; } }
      else if (state === 'single') { if (ch === "'" && text[i - 1] !== '\\') state = 'code'; }
      else if (state === 'double') { if (ch === '"' && text[i - 1] !== '\\') state = 'code'; }
      else if (state === 'template') { if (ch === '`' && text[i - 1] !== '\\') state = 'code'; }
    }
    return null;
  }
  return {
    braceEnd(from) {
      i = from;
      let ch, guard = 0;
      while ((ch = step()) !== null) { if (++guard > 1e7) throw new Error('scanUntil 超限'); if (ch === '{') break; }
      if (ch !== '{') throw new Error('未找到左花括号 @' + from);
      let depth = 0;
      i--;
      for (; i < n; i++) {
        const c = text[i], nx = text[i + 1];
        if (state === 'code') {
          if (c === '/' && nx === '/') { state = 'line-comment'; i++; continue; }
          if (c === '/' && nx === '*') { state = 'block-comment'; i++; continue; }
          if (c === "'") { state = 'single'; continue; }
          if (c === '"') { state = 'double'; continue; }
          if (c === '`') { state = 'template'; continue; }
          if (c === '{') depth++;
          else if (c === '}') { depth--; if (depth === 0) return i + 1; }
        } else if (state === 'line-comment') { if (c === '\n') state = 'code'; }
        else if (state === 'block-comment') { if (c === '*' && nx === '/') { state = 'code'; i++; } }
        else if (state === 'single') { if (c === "'" && text[i - 1] !== '\\') state = 'code'; }
        else if (state === 'double') { if (c === '"' && text[i - 1] !== '\\') state = 'code'; }
        else if (state === 'template') { if (c === '`' && text[i - 1] !== '\\') state = 'code'; }
      }
      throw new Error('花括号未闭合 @' + from);
    },
  };
}
const sc = makeScanner(src);
let okCount = 0, failCount = 0;
for (const name of fnNames) {
  const braceStart = src.indexOf('{', src.indexOf(')', src.indexOf('function ' + name + '(', 0)));
  try {
    const t0 = Date.now();
    const end = sc.braceEnd(braceStart);
    const ms = Date.now() - t0;
    if (ms > 200) console.log('  慢:', name, ms + 'ms');
    okCount++;
  } catch (e) {
    failCount++;
    console.log('  失败:', name, e.message);
  }
}
console.log(`braceEnd 成功 ${okCount} / 失败 ${failCount}`);
