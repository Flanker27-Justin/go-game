const fs = require('fs');
const p = 'work/fix-parts/part2.txt';
let cur = fs.readFileSync(p, 'utf8');
const badOld = "    live_four: '对方形成活四，必须立即防\uFFFD?,\n    rush_four: '对方形成冲四，正在逼你应手',";
const badBlock = '=====OLD-BLOCK=====\n' + badOld + '\n=====NEW-BLOCK=====\n    live_four: \'对方形成活四，必须立即防守\',\n    rush_four: \'对方形成冲四，正在逼你应手\',\n=====END-BLOCK=====\n';
if (!cur.includes(badBlock)) { console.log('badBlock NOT found!'); process.exit(1); }
cur = cur.replace(badBlock, '');
const goodBlock = '=====OLD-BLOCK=====\n    live_four: \'对方形成活四，必须立即防\uFFFD?,\n=====NEW-BLOCK=====\n    live_four: \'对方形成活四，必须立即防守\',\n=====END-BLOCK=====\n';
cur += goodBlock;
fs.writeFileSync(p, cur, 'utf8');
console.log('fixed part2 blocks:', (cur.match(/=====OLD-BLOCK=====/g) || []).length);
