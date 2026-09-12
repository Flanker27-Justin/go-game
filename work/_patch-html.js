const fs = require('fs');
const p = 'outputs/gomoku.html';
let s = fs.readFileSync(p, 'utf8');

const oldS = "function onOnlineGuessWon(winner) {\n  if (!onlineGuess) return;\n  const me = isHost ? 'host' : 'guest';\n  const iWon = winner === me;\n  onlineGuess.iAmWinner = iWon;";
const newS = "function onOnlineGuessWon(winner) {\n  if (!onlineGuess) return;\n  const me = isHost ? 'host' : 'guest';\n  const iWon = winner === me;\n  onlineGuess.locked = false;    // 揭晓后重置锁定：进入选色阶段，赢家可再提交一次选色\n  onlineGuess.iAmWinner = iWon;";
if (!s.includes(oldS)) { console.error('NOT FOUND'); process.exit(1); }
s = s.split(oldS).join(newS);
fs.writeFileSync(p, s, 'utf8');
console.log('OK: onOnlineGuessWon reset lock');
