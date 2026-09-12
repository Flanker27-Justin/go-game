const fs = require('fs');
let s = fs.readFileSync('outputs/gomoku.html', 'utf8');
const re1 = /const canChangeSize = gameMode === MODE_ONLINE[\s\S]*?\n\s*:\s*true;/;
if (!re1.test(s)) { console.error('pattern1 not found'); process.exit(1); }
s = s.replace(re1, "const canChangeSize = gameMode === MODE_ONLINE\n    ? !inRoom || isHost\n    : true;");
const re2 = /case 'board_size_changed':[\s\S]*?break;/;
if (!re2.test(s)) { console.error('pattern2 not found'); process.exit(1); }
s = s.replace(re2, "case 'board_size_changed':\n      // 房主修改棋盘大小 → 双方按新大小清空重开一局（黑方先手）\n      applyOnlineRoomSize(msg.boardSize);\n      init(MODE_ONLINE);\n      onlineStatusEl.textContent = '棋盘已切换为 ' + msg.boardSize + '×' + msg.boardSize + '，重开一局';\n      updateStatus();\n      break;");
fs.writeFileSync('outputs/gomoku.html', s);
console.log('patched OK');
