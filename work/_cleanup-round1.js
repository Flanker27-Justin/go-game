// 一次性清理：把本轮用过的临时诊断脚本与一次性迁移脚本归档到 work/archive/，
// 保留真正有用的工具与测试。用法: node work/_cleanup-round1.js
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WORK = path.join(ROOT, 'work');
const ARCHIVE = path.join(WORK, 'archive');
fs.mkdirSync(ARCHIVE, { recursive: true });

/* 一次性/临时脚本：归档（保留可追溯，不删除） */
const ARCHIVE_LIST = [
  '_analyze-engine-boundary.js',   // 依赖边界分析（已完成使命）
  '_rewrite-html-for-engine.js',   // HTML 拆分脚本（一次性）
  '_migrate-ai-tests.js',          // 测试迁移脚本（一次性）
  '_probe-ai-weakness.js',         // 分析阶段的探针
  '_probe-strength.js',
  '_probe-depth.js',
  '_probe-levers.js',
  '_debug-const-splice.js',
  '_debug-page-checks.js',
  '_debug-gen-hang.js',
  '_debug-decisions.js',
  '_debug-occupied-move.js',
  '_html-split-candidate.html',    // 拆分时的候选产物
  '_chrome-profile',               // 无头 Chrome 遗留 profile（目录）
];

/* 保留不动的工具与测试 */
const KEEP = [
  'build-engine.js', '_engine-template.js', '_test-harness.js',
  'ai-threat-test.js', 'ai-scoring-test.js', 'positions.json', 'positions-test.js',
  'bench.js', 'perf-hard-ai.js', 'verify-page-runtime.js', 'verify-engine-parity.js',
  'ws-test.js', 'online-e2e.js', 'gen-opening-book.js', 'opening-book.json',
];

let moved = 0, missing = [];
for (const name of ARCHIVE_LIST) {
  const from = path.join(WORK, name);
  if (!fs.existsSync(from)) { missing.push(name); continue; }
  const to = path.join(ARCHIVE, name);
  fs.rmSync(to, { recursive: true, force: true });
  fs.renameSync(from, to);
  moved++;
}
console.log(`已归档 ${moved} 项到 work/archive/`);
if (missing.length) console.log('（不存在，跳过）: ' + missing.join(', '));

/* 检查保留清单是否都在 */
const absent = KEEP.filter(n => !fs.existsSync(path.join(WORK, n)));
if (absent.length) console.log('!! 保留清单中缺失: ' + absent.join(', '));
console.log('\nwork/ 现有条目:');
for (const e of fs.readdirSync(WORK).sort()) console.log('  ' + e);
