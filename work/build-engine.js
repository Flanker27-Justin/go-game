// 引擎模块生成器（架构调整后）
//
// 背景：最初引擎内联在 gomoku.html 里，本脚本负责“从 HTML 抽取 → 生成模块”。
// 现在引擎已抽成 outputs/engine/gomoku-ai.js 并且**它就是唯一源头**，
// 生成器改为：以模块文件自身为输入，按标记抽取常量段/函数段/开局库段，
// 再套用 work/_engine-template.js 重新拼装。
//
// 这样做的价值：
//   1) 生成器不再依赖 gomoku.html（HTML 里已没有引擎代码）；
//   2) 一次运行即可“规范化”模块结构（函数顺序、注释、导出清单）；
//   3) 幂等：模块已是规范形态时，重跑输出完全一致。
//
// 用法: node work/build-engine.js [--check]
//   --check  只校验并打印统计，不写文件
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MODULE = path.join(ROOT, 'outputs', 'engine', 'gomoku-ai.js');
const TEMPLATE = path.join(ROOT, 'work', '_engine-template.js');
const BOOK_JSON = path.join(ROOT, 'outputs', 'engine', 'opening-book.json');
const CHECK_ONLY = process.argv.includes('--check');

/** 词法扫描器：正确跳过字符串/模板串/注释，用于取语句与函数体的精确边界 */
function makeScanner(text) {
  const n = text.length;
  let i = 0;
  let state = 'code';

  function isCodePos(pos) {
    const re = /(\/\*[\s\S]*?\*\/|\/\/[^\n]*|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`)/g;
    let m;
    while ((m = re.exec(text))) {
      if (m.index > pos) return true;
      if (pos >= m.index && pos < m.index + m[0].length) return false;
    }
    return true;
  }

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
      } else if (state === 'line-comment') {
        if (ch === '\n') state = 'code';
      } else if (state === 'block-comment') {
        if (ch === '*' && nxt === '/') { state = 'code'; i++; }
      } else if (state === 'single') {
        if (ch === "'" && text[i - 1] !== '\\') state = 'code';
      } else if (state === 'double') {
        if (ch === '"' && text[i - 1] !== '\\') state = 'code';
      } else if (state === 'template') {
        if (ch === '`' && text[i - 1] !== '\\') state = 'code';
      }
    }
    return null;
  }

  return {
    findConst(name) {
      const re = new RegExp('\\bconst\\s+' + name + '\\s*=', 'g');
      let m;
      while ((m = re.exec(text))) if (isCodePos(m.index)) return m.index;
      return -1;
    },
    /** 从 from 起找到下一条语句的结束位置（分号后一位） */
    statementEnd(from) {
      i = from;
      let ch;
      while ((ch = step()) !== null) if (ch === ';') return i + 1;
      throw new Error('语句未以分号结束 @' + from);
    },
    /** 从 from 起找到花括号块结束位置（右花括号后一位） */
    braceEnd(from) {
      i = from;
      let ch;
      while ((ch = step()) !== null) if (ch === '{') break;
      if (ch !== '{') throw new Error('未找到左花括号 @' + from);
      let depth = 0;
      i--;                                   // 回到 '{' 本身
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
    lineAt(pos) { return text.slice(0, pos).split('\n').length; },
  };
}

/* ============================================================
 * 标记：模板/模块里用固定注释标记各段，实现“可重复提取”
 * ============================================================ */
const MARK = {
  consts: '/* ---------------- 一、引擎常量',
  state: '/* ---------------- 二、引擎状态',
  funcs: '/* ---------------- 三、引擎实现',
  book: '/* ---------------- 四、开局库',
  api: '/* ---------------- 五、对外接口',
};

const src = fs.readFileSync(MODULE, 'utf8');
const lines = src.split(/\r?\n/);
const sc = makeScanner(src);

const idxOf = (marker) => {
  const i = lines.findIndex(l => l.startsWith(marker));
  if (i < 0) throw new Error('模块中找不到段落标记: ' + marker);
  return i;
};
const iConsts = idxOf(MARK.consts);
const iState = idxOf(MARK.state);
const iFuncs = idxOf(MARK.funcs);
const iBook = idxOf(MARK.book);
const iApi = idxOf(MARK.api);

/* ---------- 1. 常量段 ----------
 * ★ 必须在“二、引擎状态”标记处截断：状态变量（boardSize/board/playerColor…）
 *   由模板提供，若把它们一起抽进常量段，会和模板的状态段重复声明。 */
const constsText = lines
  .slice(iConsts + 1, iState)
  .join('\n')
  .trim();
if (/^\s*(let|const|var)\s+(boardSize|board|playerColor|aiColor|moveVariety)\b/m.test(constsText)) {
  throw new Error('常量段里混入了状态声明，说明段落边界识别有误');
}

/* ---------- 1b. 状态段 ----------
 * ★ 状态段也必须从模块抽取，而不能固定用模板里的那份：引擎状态变量会随改造增减
 *   （例如“增量棋型评估”改造新增了 evalReady / cgFive / boardHashLo / ttGen 等）。
 *   若生成器只输出模板的旧状态段，就会出现“函数用到了新状态变量、但没有声明”，
 *   运行时报 xxx is not defined（曾因此让 evalReady is not defined，
 *   整个引擎不可用、多个测试同时失败）。 */
const rawStateText = lines
  .slice(iState + 1, iFuncs)
  .join('\n')
  .trim();
/* ★ 丢弃开头的说明性注释块：它会随每次生成被搬进模块，导致产物不幂等（实测每跑一次
 *   多 9 行注释）。这里只保留真正的状态声明与紧随其后的行内注释。 */
const stateText = (() => {
  const ls = rawStateText.split('\n');
  let k = 0;
  while (k < ls.length && /^\s*(\/\*|\*|\/\/)/.test(ls[k])) {
    /* 跳过连续的注释行；遇到 /** 起始后要一直跳到其闭合行 */
    if (/^\s*\/\*/.test(ls[k]) && !/\*\/\s*$/.test(ls[k])) {
      k++;
      while (k < ls.length && !/\*\/\s*$/.test(ls[k])) k++;
      k++;
      continue;
    }
    k++;
  }
  return ls.slice(k).join('\n').trim();
})();
if (!stateText) throw new Error('状态段为空，段落边界可能失配');
if (!/^\s*(let|const|var)\s+boardSize\b/m.test(stateText)) {
  throw new Error('状态段里没有 boardSize 声明，段落边界可能失配');
}
/* 自检：状态段必须覆盖模块里出现的全部顶层声明（防止漏抽） */
{
  const body = lines.slice(iState, iFuncs).join('\n');
  const declaredInModule = new Set([...body.matchAll(/^\s*(?:let|const|var)\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1]));
  const declaredInText = new Set([...stateText.matchAll(/^\s*(?:let|const|var)\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1]));
  const missing = [...declaredInModule].filter(n => !declaredInText.has(n));
  if (missing.length) throw new Error('状态段抽取不完整，缺少: ' + missing.join(', '));
}

/* ---------- 2. 函数段：按顶层 function 逐个重建（保留 JSDoc） ---------- */
const funcsText = lines.slice(iFuncs + 1, iBook).join('\n').trim();
const fnNames = [...funcsText.matchAll(/^function\s+([A-Za-z_$][\w$]*)\s*\(/gm)].map(m => m[1]);
if (fnNames.length < 35) throw new Error(`函数数量异常: ${fnNames.length}`);

/** 从函数段里取出某个函数（含前面的连续注释行） */
function takeFunction(name) {
  const seg = funcsText.split('\n');
  const at = seg.findIndex(l => new RegExp('^function\\s+' + name + '\\s*\\(').test(l));
  if (at < 0) throw new Error('函数段中未找到 ' + name);
  const braceStart = src.indexOf('{', src.indexOf(')', src.indexOf('function ' + name + '(', 0)));
  const end = sc.braceEnd(braceStart);
  const endLine = src.slice(0, end).split('\n').length;   // 绝对行号（相对模块文件）
  let top = at;
  while (top > 0 && /^\s*(\*|\/\*|\/\/)/.test(seg[top - 1])) top--;
  const absStartLine = iFuncs + 1 + top;                  // iFuncs 是标记行索引
  return lines.slice(absStartLine, endLine).join('\n').replace(/\s+$/, '');
}
console.log(`[gen] 开始重建 ${fnNames.length} 个函数...`);
const funcsRebuilt = fnNames.map((n, idx) => {
  const r = takeFunction(n);
  if (idx % 10 === 0) console.log(`[gen]   ${idx}/${fnNames.length} … ${n}`);
  return r;
}).join('\n\n');
console.log('[gen] 函数段重建完成，长度', funcsRebuilt.length);

/* ---------- 3. 开局库段 ---------- */
const bookLine = lines.slice(iBook, iApi).find(l => l.startsWith('const OPENING_BOOK = '));
if (!bookLine) throw new Error('模块中未找到 OPENING_BOOK 定义');
const bookLiteral = bookLine.slice(bookLine.indexOf('{'), bookLine.lastIndexOf('}') + 1);
const bookData = JSON.parse(bookLiteral);
const bookKeys = Object.keys(bookData).length;
const bookEntries = Object.values(bookData).reduce((n, v) => n + v.length, 0);

/* ---------- 4. 渲染模板 ---------- */
let out = fs.readFileSync(TEMPLATE, 'utf8');
out = out.replace('@@CONSTS@@', () => constsText);
out = out.replace('@@STATE@@', () => stateText);
out = out.replace('@@FUNCS@@', () => funcsRebuilt);
out = out.replace('@@OPENING_BOOK@@', () => 'const OPENING_BOOK = ' + JSON.stringify(bookData) + ';');

/* ---------- 5. 自检 ---------- */
const problems = [];
/* 占位符自检：只认“独占一行的 @@NAME@@”（正文里对占位符的说明性提及不算） */
const leftover = [...out.matchAll(/^\s*@@[A-Z_]+@@\s*$/gm)].map(m => m[0].trim());
if (leftover.length) problems.push('模板仍有未替换的占位符: ' + [...new Set(leftover)].join(', '));

function codeOnly(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}
const code = codeOnly(out);
const declared = [...code.matchAll(/^function\s+([A-Za-z_$][\w$]*)\s*\(/gm)].map(m => m[1]);
const dupes = declared.filter((n, i) => declared.indexOf(n) !== i);
if (dupes.length) problems.push('重复函数定义: ' + [...new Set(dupes)].join(', '));
if (declared.length !== fnNames.length) problems.push(`函数数量不符: ${declared.length} vs ${fnNames.length}`);

const TEMPLATE_API = new Set(['setBoardSize', 'resizeBoard', 'setColors', 'setMoveVariety', 'resetState',
  'evalStats', 'ensureEvalState', 'publicFn']);
const MODULE_DATA = new Set(['board', 'boardSize', 'playerColor', 'aiColor', 'moveVariety', 'lastVcfPath', 'lastVctPath']);
const NESTED_LOCAL = new Set(['counterScore', 'tieScore', 'consider', 'push', 'addPt', 'pushBits']);
const BUILTIN = new Set(['Array', 'Math', 'JSON', 'Object', 'Number', 'String', 'Set', 'Map', 'Int32Array',
  'Infinity', 'parseInt', 'parseFloat', 'isNaN', 'if', 'for', 'while', 'switch', 'catch', 'return',
  'function', 'typeof', 'new', 'do', 'else', 'factory']);
const called = new Set([...code.matchAll(/(?:^|[^\w.$])([A-Za-z_$][\w$]*)\s*\(/gm)].map(m => m[1]));
const undefinedCalls = [...called].filter(n =>
  !declared.includes(n) && !TEMPLATE_API.has(n) && !MODULE_DATA.has(n) && !NESTED_LOCAL.has(n) && !BUILTIN.has(n) && !/^[A-Z]/.test(n));
if (undefinedCalls.length) problems.push('调用了未定义的函数: ' + undefinedCalls.join(', '));

const constNames = new Set([...code.matchAll(/const\s+([A-Z][A-Z0-9_]*)\s*=/g)].map(m => m[1]));
const usedConsts = new Set([...code.matchAll(/\b([A-Z][A-Z0-9_]{2,})\b/g)].map(m => m[1]));
const undefinedConsts = [...usedConsts].filter(n => !constNames.has(n) && n !== 'AI_COLOR');
if (undefinedConsts.length) problems.push('使用了未定义的常量: ' + undefinedConsts.join(', '));

for (const must of ['getBestMove', 'bestBySearch', 'minimax', 'findVcfWin', 'findVctWin', 'inBoard']) {
  if (!declared.includes(must)) problems.push('缺少关键函数: ' + must);
}
if (bookKeys < 20) problems.push('开局库键数量异常: ' + bookKeys);

/* 语法校验：产物必须能被 Node 解析 */
try { new (require('vm').Script)(out, { filename: 'gomoku-ai.js' }); }
catch (e) { problems.push('产物语法错误: ' + e.message); }

console.log('==== 引擎模块生成报告 ====');
console.log(`函数 ${declared.length} 个（含 inBoard）`);
console.log(`常量段 ${constsText.split('\n').length} 行，开局库 ${bookKeys} 键 / ${bookEntries} 条应答`);
console.log(`产物 ${(Buffer.byteLength(out, 'utf8') / 1024).toFixed(1)}KB，与现有文件${out === src ? '完全一致（无需改动）' : '有差异（将更新）'}`);

/* 诊断：产物里所有 boardSize 声明位置（重复声明是最容易踩的坑） */
{
  const outs = out.split('\n');
  const decls = [];
  outs.forEach((l, i) => { if (/^\s*(let|const|var)\s+boardSize\b/.test(l)) decls.push(`L${i + 1}: ${l.trim()}`); });
  console.log(`产物中 boardSize 声明 ${decls.length} 处: ` + decls.join(' | '));
  const consLines = constsText.split('\n');
  const strayState = consLines.filter(l => /^\s*(let|const|var)\s+(boardSize|board|playerColor|aiColor|moveVariety)\b/.test(l));
  if (strayState.length) console.log('!! 常量段里混入了状态声明: ' + strayState.map(s => s.trim()).join(' | '));
}

if (problems.length) {
  console.log('\n!! 自检失败:');
  for (const p of problems) console.log('  - ' + p);
  process.exit(1);
}
console.log('自检通过');
if (CHECK_ONLY) { console.log('(--check 模式，未写文件)'); process.exit(0); }

fs.writeFileSync(MODULE, out, 'utf8');
fs.writeFileSync(BOOK_JSON, JSON.stringify(bookData), 'utf8');
console.log('已写出: outputs/engine/gomoku-ai.js + opening-book.json');
