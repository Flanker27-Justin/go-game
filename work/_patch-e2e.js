const fs = require('fs');
const p = 'work/online-e2e.js';
let s = fs.readFileSync(p, 'utf8');

function rep(oldS, newS, label) {
  if (!s.includes(oldS)) { console.error('NOT FOUND: ' + label); process.exit(1); }
  s = s.split(oldS).join(newS);
  console.log('OK: ' + label);
}

// 1) 头部注释
rep(
  " * 流程：建房（自动复制/二维码/大字房间号）→ 邀请链接入局 → 对弈数手\n *       → 刷新页面自动重连恢复局面 → 继续对弈至分出胜负\n *       → 再来一局 → 重开后继续落子。",
  " * 流程：建房（自动复制/二维码/大字房间号）→ 邀请链接入局 → 对弈数手\n *       → 刷新页面自动重连恢复局面 → 继续对弈至分出胜负\n *       → 再来一局 → 重开后继续落子；联机猜先（默认开启，颜色与角色解耦）。\n * 说明：主流程建房前关闭“开局猜先”以保持固定黑白断言；猜先流程在独立小节验证。",
  'e2e header'
);

// 2) 猜先辅助函数（插在 clickCell 之后）
rep(
  "  const clickCell = async (page, bx, r, c) => {\n    const step = (bx.width - 40) / 18;          // 19 路格距 = 40px；按实际画布宽度自适应\n    await page.locator('#board').click({ position: { x: 20 + c * step, y: 20 + r * step } });\n  };",
  "  const clickCell = async (page, bx, r, c) => {\n    const step = (bx.width - 40) / 18;          // 19 路格距 = 40px；按实际画布宽度自适应\n    await page.locator('#board').click({ position: { x: 20 + c * step, y: 20 + r * step } });\n  };\n  // 联机猜先全流程：被选中方猜硬币面 → 赢家选执黑 → 等 color_assigned 开局。\n  // 硬币结果与先选方都由服务器随机决定，这里自适应读取弹窗状态，不依赖具体哪一方。\n  const completeOnlineGuess = async (hostPage, guestPage) => {\n    await hostPage.waitForTimeout(700);\n    await guestPage.waitForTimeout(700);\n    const hCoin = await hostPage.locator('#ogCoinPick').isVisible();\n    const gCoin = await guestPage.locator('#ogCoinPick').isVisible();\n    if (hCoin) await hostPage.locator('#ogBtnHeads').click();\n    else if (gCoin) await guestPage.locator('#ogBtnHeads').click();\n    else throw new Error('猜先弹窗未出现（ogCoinPick 双方都不可见）');\n    await hostPage.waitForTimeout(500);\n    await guestPage.waitForTimeout(500);\n    const hPick = await hostPage.locator('#ogColorPick').isVisible();\n    const gPick = await guestPage.locator('#ogColorPick').isVisible();\n    if (hPick) await hostPage.locator('#ogBtnBlack').click();\n    else if (gPick) await guestPage.locator('#ogBtnBlack').click();\n    else throw new Error('猜先结果未揭晓（ogColorPick 双方都不可见）');\n    await hostPage.waitForTimeout(700);\n    await guestPage.waitForTimeout(700);\n  };",
  'e2e guess helper'
);

fs.writeFileSync(p, s, 'utf8');
console.log('DONE');
