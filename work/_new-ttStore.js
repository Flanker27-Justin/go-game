/**
 * 写置换表：窗口过窄会存 LOWER/UPPER，完整搜索存 EXACT。
 * 同一代内保留更深的条目；表满时按代龄淘汰旧条目（而不是整表清空，
 * 旧实现的 clear() 会把整局积累一次性丢掉）。
 */
function ttStore(key, depth, flag, val) {
  if (!ttMap) return;
  if (ttMap.size >= TT_MAX_ENTRIES) {
    const keepFrom = ttGen - TT_SWEEP_KEEP_GENS;
    for (const [k, e] of ttMap) if (e.g < keepFrom) ttMap.delete(k);
    if (ttMap.size >= TT_MAX_ENTRIES) ttMap.clear();
  }
  const old = ttMap.get(key);
  if (old !== undefined && old.g === ttGen && old.d > depth) return;
  ttMap.set(key, { d: depth, f: flag, v: val, g: ttGen });
}
