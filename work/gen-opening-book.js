// 开局库生成器：用引擎自身搜索（深度3）为开局局面生成 top-N 应答，规范化（8 对称）后输出
const fs = require('fs');
const src = fs.readFileSync('outputs/gomoku.html', 'utf8');
function extractFn(name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('未找到函数 ' + name);
  const brace = src.indexOf('{', src.indexOf(')', start));
  let depth = 0, i = brace;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(start, i + 1);
}
const fns = ['inBoard','lineInfo','lineScore','directionScore','evaluateCell','threatLevel',
 'scoreFor','resolveThreats','canWinNow','findImmediateWin','getCandidateMoves','evaluateBoard',
 'comboBonus','countThreats','threatSpaceBonus','minimax','bestBySearch','bestByScore','getBestMove','searchDepth',
 'forcingMovesOf','findVcfWin','vcfSearch','vcfForcingMoves','vcfBlockPoints','findDoubleThreat',
 'findDoubleKill','findOpponentDoubleThreat','openingMove','pickVaried','pickTopN','initSearchTables','hashXor','ttStore'];
const body = fns.map(extractFn).join('\n');
const api = new Function(
  'boardSize','board','EMPTY','BLACK','WHITE','AI_COLOR','DIRECTIONS','LIVE_THREE_SCORE',
  'HINT_RADIUS','WIN_SCORE','SEARCH_DEPTH','CANDIDATE_LIMIT','ROOT_CANDIDATE_LIMIT','SEARCH_BUDGET_MS',
  'VCF_MAX_PLIES','VCF_NODE_LIMIT','VCF_TIME_BUDGET_MS',
  'OPENING_TOTAL_MOVES','OPENING_DOUBLE_BONUS','PATTERN_TABLE','CONNECT_BONUS','CENTER_WEIGHT','DOUBLE_THREAT_BONUS','TEMPO_BONUS',
  'LEVEL_EASY','LEVEL_MEDIUM','LEVEL_HARD','playerColor','aiColor','moveVariety','searchState','lastVcfPath','performance',
  'TT_MAX_ENTRIES','TT_EXACT','TT_LOWER','TT_UPPER','TT_SIDE_ME','TT_SIDE_OPP','TT_PERSP_BLACK','TT_PERSP_WHITE',
  'let ttMap=null;let ttZobrist=null;let boardHash=0;let historyTable=null;let killerTable=null;\n' + body + ';\nreturn {initSearchTables,hashXor,minimax,getCandidateMoves};');
const S=19, EMPTY=0, BLACK=1, WHITE=2, AI_COLOR=WHITE, CENTER=9;
const DIRECTIONS=[[1,0],[0,1],[1,1],[1,-1]], LIVE_THREE_SCORE=10000, HINT_RADIUS=2, WIN_SCORE=100000000;
const SEARCH_DEPTH=3, CANDIDATE_LIMIT=16, ROOT_CANDIDATE_LIMIT=18, SEARCH_BUDGET_MS=4000;
const VCF_MAX_PLIES=10, VCF_NODE_LIMIT=5000, VCF_TIME_BUDGET_MS=250;
const OPENING_TOTAL_MOVES=8, OPENING_DOUBLE_BONUS=20000, CONNECT_BONUS=30, CENTER_WEIGHT=25, DOUBLE_THREAT_BONUS=30000, TEMPO_BONUS=1500;
const PATTERN_TABLE=[[0,0,0],[10,10,100],[100,100,1000],[1000,1000,10000],[10000,10000,100000],[1000000,1000000,1000000]];
const TT_MAX_ENTRIES=300000, TT_EXACT=0, TT_LOWER=1, TT_UPPER=2, TT_SIDE_ME=0x9E3779B9, TT_SIDE_OPP=0x85EBCA77;
const TT_PERSP_BLACK=0x6D2B79F5, TT_PERSP_WHITE=0x1B56C4E9;
const LEVEL_EASY='easy', LEVEL_MEDIUM='medium', LEVEL_HARD='hard';
let playerColor=BLACK, aiColor=WHITE, moveVariety=0, searchState=null, lastVcfPath=null;
const performance={now:()=>Date.now()};
const board=Array.from({length:S},()=>Array(S).fill(EMPTY));
const A=api(S,board,EMPTY,BLACK,WHITE,AI_COLOR,DIRECTIONS,LIVE_THREE_SCORE,HINT_RADIUS,WIN_SCORE,SEARCH_DEPTH,CANDIDATE_LIMIT,ROOT_CANDIDATE_LIMIT,SEARCH_BUDGET_MS,VCF_MAX_PLIES,VCF_NODE_LIMIT,VCF_TIME_BUDGET_MS,OPENING_TOTAL_MOVES,OPENING_DOUBLE_BONUS,PATTERN_TABLE,CONNECT_BONUS,CENTER_WEIGHT,DOUBLE_THREAT_BONUS,TEMPO_BONUS,LEVEL_EASY,LEVEL_MEDIUM,LEVEL_HARD,playerColor,aiColor,moveVariety,searchState,lastVcfPath,performance,TT_MAX_ENTRIES,TT_EXACT,TT_LOWER,TT_UPPER,TT_SIDE_ME,TT_SIDE_OPP,TT_PERSP_BLACK,TT_PERSP_WHITE);

// 8 对称（相对中心坐标 (x,y)=(r-9,c-9)）与其逆
const SYM = [
  (x,y)=>[x,y], (x,y)=>[-y,x], (x,y)=>[-x,-y], (x,y)=>[y,-x],
  (x,y)=>[x,-y], (x,y)=>[-x,y], (x,y)=>[y,x], (x,y)=>[-y,-x],
];
const INV = [0,3,2,1,4,5,6,7];
function canonicalize(stones, side) {
  let bestStr = null, bestSym = 0;
  for (let s = 0; s < 8; s++) {
    const pts = stones.map(st => { const [x,y]=SYM[s](st.r-CENTER, st.c-CENTER); return [x,y,st.color]; });
    pts.sort((a,b)=>a[0]-b[0]||a[1]-b[1]||a[2]-b[2]);
    const str = pts.map(p=>p[0]+','+p[1]+','+p[2]).join(';');
    if (bestStr === null || str < bestStr) { bestStr = str; bestSym = s; }
  }
  return { key: (side === BLACK ? 'B' : 'W') + '|' + bestStr, sym: bestSym };
}
function resetB(){ for(let r=0;r<S;r++)for(let c=0;c<S;c++)board[r][c]=EMPTY; }
function rootTopN(me, opp, budget) {
  A.initSearchTables();
  searchState = { t0: Date.now(), budget: budget };
  const moves = A.getCandidateMoves(ROOT_CANDIDATE_LIMIT, me);
  const scored = [];
  for (const [r,c] of moves) {
    board[r][c] = me; A.hashXor(r,c,me);
    const v = A.minimax(2, -Infinity, Infinity, false, me, opp);
    A.hashXor(r,c,me); board[r][c] = EMPTY;
    scored.push({r,c,v});
  }
  scored.sort((a,b)=>b.v-a.v);
  return scored;
}
const W = [5,4,3,2,1];
const book = {};
const visited = new Set();
function expand(stones, me, level) {
  const opp = me === BLACK ? WHITE : BLACK;
  const topN = level === 0 ? 1 : (level <= 2 ? 5 : level === 3 ? 4 : 3);
  const expandCount = level === 0 ? 1 : level === 1 ? 6 : level === 2 ? 5 : level === 3 ? 4
    : level === 4 ? 3 : level === 5 ? 3 : level === 6 ? 2 : level === 7 ? 1 : 0;  // 8 子收尾，控制规模
  resetB();
  for (const s of stones) board[s.r][s.c] = s.color;
  // 空盘没有候选锚点：黑首手固定天元（中心），这也是五子棋标准开局
  const scored = level === 0
    ? [{ r: CENTER, c: CENTER, v: 0 }]
    : rootTopN(me, opp, level <= 3 ? 4000 : (level <= 6 ? 2500 : 2000));
  const { key, sym } = canonicalize(stones, me);
  if (visited.has(key)) return;          // 对称折叠：同一规范化局面只处理一次
  visited.add(key);
  if (!book[key]) book[key] = [];
  const seen = new Set();
  for (const {r,c} of scored.slice(0, topN)) {
    const [x,y] = SYM[sym](r-CENTER, c-CENTER);
    const sig = x+','+y;
    if (seen.has(sig)) continue;
    seen.add(sig);
    book[key].push([x, y, W[book[key].length] || 1]);
  }
  if (level < 8) {  // 扩展到 8 子（约前 9 手都有库内应答）
    for (let i = 0; i < Math.min(expandCount, scored.length); i++) {
      const {r,c} = scored[i];
      stones.push({r,c,color:me});
      expand(stones, opp, level+1);
      stones.pop();
    }
  }
}
const t0 = Date.now();
expand([], BLACK, 0);
const dt = ((Date.now()-t0)/1000).toFixed(1);
let totalEntries = 0;
for (const k of Object.keys(book)) totalEntries += book[k].length;
console.log('生成完成：局面数=' + Object.keys(book).length + ' 应答条目=' + totalEntries + ' 耗时=' + dt + 's');
const bySide = { B: 0, W: 0 };
for (const k of Object.keys(book)) bySide[k[0]]++;
console.log('其中轮到黑应答=' + bySide.B + ' 轮到白应答=' + bySide.W);
// 抽样检查
const sampleKeys = Object.keys(book).filter(k=>k.startsWith('W|')).slice(0,3);
for (const k of sampleKeys) console.log('  示例 ' + k + ' -> ' + JSON.stringify(book[k]));
// 关键局面校验
console.log('空盘(黑先) key=' + canonicalize([], BLACK).key + ' -> ' + JSON.stringify(book[canonicalize([], BLACK).key]));
const pos1 = [{r:9,c:9,color:BLACK}];
console.log('黑天元(白应) key=' + canonicalize(pos1, WHITE).key + ' -> ' + JSON.stringify(book[canonicalize(pos1, WHITE).key]));
const pos2 = [{r:9,c:9,color:BLACK},{r:9,c:7,color:WHITE},{r:9,c:8,color:BLACK},{r:10,c:8,color:WHITE},{r:11,c:9,color:BLACK}];
const c2 = canonicalize(pos2, WHITE);
console.log('场景15第二局面 key=' + c2.key + ' 是否在库=' + (!!book[c2.key]) + ' -> ' + JSON.stringify(book[c2.key] || null));
fs.writeFileSync('work/opening-book.json', JSON.stringify(book));
console.log('已写入 work/opening-book.json');
