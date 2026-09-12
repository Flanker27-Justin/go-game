// 文档一致性检查：对照 outputs/使用说明.md 与实际代码/文件，列出过时之处。
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const DOC = path.join(ROOT, 'outputs', '使用说明.md');
const doc = fs.readFileSync(DOC, 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'outputs', 'gomoku.html'), 'utf8');

const items = [];
const add = (ok, title, detail) => items.push({ ok, title, detail });

/* 1. 文件清单：gomoku.html 是否仍是“单文件零依赖” */
const engineExists = fs.existsSync(path.join(ROOT, 'outputs', 'engine', 'gomoku-ai.js'));
const htmlRefsEngine = html.includes('engine/gomoku-ai.js');
/* 判定改为：文档必须**解释了**引擎拆分这件事（允许保留“单文件”字样作为历史说明），
 * 且不能出现“直接双击打开也可以”这种会被误解成“只拷一个文件就行”的误导性表述。 */
const explainsSplit = /engine\/gomoku-ai\.js/.test(doc) && /不能只拷|必须连同|需与 `engine\/`|必须保持同目录/.test(doc);
add(explainsSplit, '文档是否解释了「引擎已拆分、不能只拷 gomoku.html」',
  explainsSplit ? '已解释' : '**未解释**，读者可能只拷一个文件导致页面失效');
add(!/直接双击打开 `gomoku\.html` 也可以（在线对战功能除外）/.test(doc),
  '是否仍存在“直接双击打开也可以”的误导性表述',
  /直接双击打开 `gomoku\.html` 也可以（在线对战功能除外）/.test(doc) ? '**仍存在**' : '已澄清');
add(doc.includes('engine/gomoku-ai.js'), '文件清单是否列出引擎模块',
  doc.includes('engine/gomoku-ai.js') ? '已列出' : '**未列出** outputs/engine/gomoku-ai.js');

/* 2. 测试断言数 */
const runCount = (file) => {
  const p = path.join(ROOT, 'work', file);
  if (!fs.existsSync(p)) return null;
  const m = /结果：(\d+) 通过, (\d+) 失败/.exec(fs.readFileSync(p, 'utf8'));
  return m ? Number(m[1]) : null;
};
const threatSrc = fs.readFileSync(path.join(ROOT, 'work', 'ai-threat-test.js'), 'utf8');
const scoringSrc = fs.readFileSync(path.join(ROOT, 'work', 'ai-scoring-test.js'), 'utf8');
const threatAssert = (threatSrc.match(/check(?:True|Any)?\(/g) || []).length + (threatSrc.match(/checkTrue\(/g) || []).length;
add(/ai-threat-test\.js[^\n]*72 项断言/.test(doc) === false, 'ai-threat-test 断言数（文档写 72）',
  '实际运行结果见下方测量；文档里的固定数字容易过时');
add(/ai-scoring-test\.js[^\n]*41 项断言/.test(doc) === false, 'ai-scoring-test 断言数（文档写 41）',
  '实际运行结果见下方测量');
add(doc.includes('positions-test') && doc.includes('bench.js') && doc.includes('matchup'),
  '是否补充了新增测试与工具', 
  doc.includes('positions-test') ? '已提及' : '**未提及** positions-test.js / bench.js / matchup.js / duel2.js / verify-page-runtime.js / build-engine.js / audit.js');

/* 3. 七、跑一遍自动化测试 章节的准确性 */
const sec7 = /## 七、跑一遍自动化测试([\s\S]*?)## 八、/.exec(doc);
if (sec7) {
  const body = sec7[1];
  add(body.includes('work/ai-threat-test.js') && body.includes('work/ai-scoring-test.js'), '测试章节是否包含 AI 断言测试', '');
  add(/前三个脚本会自动拉起服务器/.test(body) === false, '测试章节结尾说明是否仍然正确',
    '旧文案“前三个脚本会自动拉起服务器”已过时（只有 ws-test/online-e2e 需要服务器）');
  add(/73 项断言/.test(body), 'AI 断言数是否已更新（应为 73 / 45）',
    /73 项断言/.test(body) ? '已更新' : '**仍是旧数字**');
  add(/positions-test/.test(body) && /verify-page-runtime/.test(body), '测试章节是否收录新增测试',
    /positions-test/.test(body) ? '已收录' : '**未收录** positions-test / verify-page-runtime 等');
}

/* 3b. 异地联机一键启动脚本是否被记录、且文件确实存在 */
{
  const bat = path.join(ROOT, 'outputs', '启动异地联机.bat');
  const ps1 = path.join(ROOT, 'outputs', '启动异地联机.ps1');
  add(fs.existsSync(bat) && fs.existsSync(ps1), '异地联机启动脚本是否存在', `bat=${fs.existsSync(bat)} ps1=${fs.existsSync(ps1)}`);
  add(doc.includes('启动异地联机.bat'), '文档是否介绍异地联机启动', doc.includes('启动异地联机.bat') ? '已介绍' : '**未介绍**');
  /* 文档应把「异地 + cpolar」作为联机主线，而不是局域网 */
  add(!/启动联网版/.test(doc) && !/启动五子棋\.bat/.test(doc), '是否已清理旧的局域网版启动脚本引用',
    (/启动联网版/.test(doc) || /启动五子棋\.bat/.test(doc)) ? '**仍残留旧脚本引用**' : '已清理');
  add(/cpolar/.test(doc) && /公网/.test(doc), '文档是否说明异地方案依赖 cpolar 与公网地址',
    /cpolar/.test(doc) ? '已说明' : '**未说明**');
  /* bat 里的中文只允许出现在“必须引用的中文文件名”上；除此之外全是 ASCII。
   * 中文文件名的 UTF-8 编码约 18 字节/次，脚本里引用两次 → 上限取 80 字节。 */
  if (fs.existsSync(bat)) {
    const bytes = fs.readFileSync(bat);
    const nonAscii = [...bytes].filter(b => b > 127).length;
    add(nonAscii <= 80, '启动脚本 .bat 的非 ASCII 字节是否仅为中文文件名引用（≤80）',
      nonAscii <= 80 ? `是（${nonAscii} 字节）` : `否，${nonAscii} 字节（可能混入了中文注释/文案，代码页下有乱码风险）`);
  }
  /* ps1 需要有 UTF-8 BOM，否则 Windows PowerShell 5.1 下中文会按 ANSI 解析 */
  if (fs.existsSync(ps1)) {
    const b = fs.readFileSync(ps1);
    const hasBom = b.length >= 3 && b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF;
    add(hasBom, '启动脚本 .ps1 是否带 UTF-8 BOM（PS 5.1 兼容）', hasBom ? '是' : '**否**，5.1 下中文会乱码');
  }
}

/* 4. AI 说明中的参数位置 */
add(!/所有可调参数集中在此/.test(doc), 'AI 参数位置说明', '文档若说“所有可调参数集中在一处”，现已分散到引擎模块');

/* 5. 判胜方向 / 难度描述是否与引擎一致 */
const engine = fs.readFileSync(path.join(ROOT, 'outputs', 'engine', 'gomoku-ai.js'), 'utf8');
const rushFour = /\[20000, 20000, 100000\]/.test(engine);
add(doc.includes('冲四') === false || !/冲四.*10000.*活三.*10000/.test(doc),
  '棋型分值描述是否仍成立', rushFour ? '引擎已把冲四改为 20000（与活三分层），文档若宣称“冲四=活三”则过时' : '');

/* 6. 文件清单是否遗漏测试/工具 */
for (const f of ['work/positions.json', 'work/build-engine.js', 'work/matchup.js', 'work/duel2.js',
  'work/verify-page-runtime.js', 'work/perf-hard-ai.js', 'work/audit.js', 'work/gen-opening-book2.js']) {
  const exists = fs.existsSync(path.join(ROOT, f));
  if (exists) add(doc.includes(path.basename(f)), `文件清单是否提到 ${f}`, doc.includes(path.basename(f)) ? '已提到' : '**未提到**');
}

console.log('==== 使用说明.md 一致性检查 ====');
let stale = 0;
for (const it of items) {
  if (!it.ok) stale++;
  console.log(`${it.ok ? '✓' : '✗'} ${it.title}`);
  if (it.detail) console.log(`    ${it.detail}`);
}
console.log(`\n需要更新的条目: ${stale} / ${items.length}`);
