// 验证“从 cpolar.yml 读取命名隧道端口”的解析逻辑（与启动脚本里同一套正则）
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const cfgPath = path.join(os.homedir(), '.cpolar', 'cpolar.yml');
console.log('配置文件: ' + cfgPath);
const cfg = fs.readFileSync(cfgPath, 'utf8');

function tunnelPort(cfg, name) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  /* 注意：PowerShell 用 .NET 正则（支持 (?m) 内联标志），JS 不支持，
   * 因此这里用 m 标志位表达同样的语义。 */
  const has = new RegExp('^\\s{2,}' + esc + '\\s*:', 'm').test(cfg);
  if (!has) return { has: false, port: 0 };
  const m = new RegExp('^\\s{2,}' + esc + '\\s*:\\s*\\n((?:\\s+\\w+:.*\\n?)+)', 'ms').exec(cfg);
  let port = 0;
  if (m && /addr:\s*"?(\d+)"?/.test(m[1])) port = Number(/addr:\s*"?(\d+)"?/.exec(m[1])[1]);
  return { has: true, port };
}

console.log('\n隧道端口解析结果：');
for (const name of ['gomoku', 'website', 'remoteDesktop', 'nosuch']) {
  const r = tunnelPort(cfg, name);
  console.log(`  ${name.padEnd(14)} 存在=${String(r.has).padEnd(5)} 端口=${r.port || '(未读到)'}`);
}
const ok = tunnelPort(cfg, 'gomoku').port === 8123;
console.log(`\n判定：gomoku 隧道端口应为 8123 → ${ok ? '✓ 解析正确' : '✗ 解析有误'}`);
process.exit(ok ? 0 : 1);
