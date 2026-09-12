// 生成一批“参数级”候选引擎：同源、各只改一处，便于用 A/B 对弈归因。
// 这些改动都是低风险的（不改决策架构、不动评估实现），目标是找到实测有效的提升。
// 用法: node work/_make-param-candidates.js
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'outputs', 'engine', 'gomoku-ai.js');
const OUTDIR = path.join(ROOT, 'work', 'archive');
const base = fs.readFileSync(SRC, 'utf8');

/** 候选定义：名称 → { 说明, 替换列表 [[from, to], ...] }（每处都必须命中） } */
const CANDIDATES = [
  {
    name: 'cand-wide',
    desc: '搜索宽度：候选点上限 16→22、根候选 18→26',
    edits: [
      ['const CANDIDATE_LIMIT = 16;', 'const CANDIDATE_LIMIT = 22;'],
      ['const ROOT_CANDIDATE_LIMIT = 18;', 'const ROOT_CANDIDATE_LIMIT = 26;'],
    ],
  },
  {
    name: 'cand-radius',
    desc: '候选收集半径 HINT_RADIUS 2→3（中后盘杀棋链更不易被漏掉）',
    edits: [
      ['const HINT_RADIUS = 2;', 'const HINT_RADIUS = 3;'],
    ],
  },
  {
    name: 'cand-vcf',
    desc: 'VCF 连杀窗口：10 层/5000 节点/250ms → 16 层/30000 节点/600ms',
    edits: [
      ['const VCF_MAX_PLIES = 10;', 'const VCF_MAX_PLIES = 16;'],
      ['const VCF_NODE_LIMIT = 5000;', 'const VCF_NODE_LIMIT = 30000;'],
      ['const VCF_TIME_BUDGET_MS = 250;', 'const VCF_TIME_BUDGET_MS = 600;'],
    ],
  },
  {
    name: 'cand-vct',
    desc: 'VCT 活三链窗口：10 层/5000 节点/300ms → 14 层/30000 节点/900ms',
    edits: [
      ['const VCT_MAX_PLIES = 10;', 'const VCT_MAX_PLIES = 14;'],
      ['const VCT_NODE_LIMIT = 5000;', 'const VCT_NODE_LIMIT = 30000;'],
      ['const VCT_TIME_BUDGET_MS = 300;', 'const VCT_TIME_BUDGET_MS = 900;'],
    ],
  },
  {
    name: 'cand-time',
    desc: '搜索预算 2500ms→5000ms（仅 hard 档）',
    edits: [
      ['const SEARCH_BUDGET_MS = 2500;', 'const SEARCH_BUDGET_MS = 5000;'],
    ],
  },
  {
    name: 'cand-all',
    desc: '组合：宽度 + 半径 + VCF/VCT 窗口（不含时间预算）',
    edits: [
      ['const CANDIDATE_LIMIT = 16;', 'const CANDIDATE_LIMIT = 22;'],
      ['const ROOT_CANDIDATE_LIMIT = 18;', 'const ROOT_CANDIDATE_LIMIT = 26;'],
      ['const HINT_RADIUS = 2;', 'const HINT_RADIUS = 3;'],
      ['const VCF_MAX_PLIES = 10;', 'const VCF_MAX_PLIES = 16;'],
      ['const VCF_NODE_LIMIT = 5000;', 'const VCF_NODE_LIMIT = 30000;'],
      ['const VCF_TIME_BUDGET_MS = 250;', 'const VCF_TIME_BUDGET_MS = 600;'],
      ['const VCT_MAX_PLIES = 10;', 'const VCT_MAX_PLIES = 14;'],
      ['const VCT_NODE_LIMIT = 5000;', 'const VCT_NODE_LIMIT = 30000;'],
      ['const VCT_TIME_BUDGET_MS = 300;', 'const VCT_TIME_BUDGET_MS = 900;'],
    ],
  },
];

const written = [];
for (const cand of CANDIDATES) {
  let src = base;
  const misses = [];
  for (const [from, to] of cand.edits) {
    if (!src.includes(from)) { misses.push(from); continue; }
    src = src.replace(from, to);
  }
  if (misses.length) {
    console.log(`!! ${cand.name} 有 ${misses.length} 处未命中: ${misses.join(' | ')}`);
    continue;
  }
  /* 语法自检 */
  try { new (require('vm').Script)(src, { filename: cand.name + '.js' }); }
  catch (e) { console.log(`!! ${cand.name} 语法错误: ${e.message}`); continue; }
  const out = path.join(OUTDIR, `_engine-${cand.name}.js`);
  fs.writeFileSync(out, src, 'utf8');
  written.push({ name: cand.name, desc: cand.desc, file: out });
  console.log(`已生成 ${cand.name}: ${cand.desc}`);
}
console.log(`\n共生成 ${written.length} 个参数候选，位于 work/archive/`);
