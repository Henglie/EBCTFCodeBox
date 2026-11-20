const cache = new WeakMap();

function indexOf(list) {
  if (cache.has(list)) return cache.get(list);
  const idx = list.map((op, i) => ({
    op,
    i,
    id: op.id.toLowerCase(),
    name: String(op.name || "").toLowerCase(),
    desc: String(op.desc || "").toLowerCase(),
    aka: (op.aliases || []).join(" ").toLowerCase(),
  }));
  cache.set(list, idx);
  return idx;
}

export function searchOps(list, query, cats = []) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return list.slice();
  const terms = q.split(/\s+/).filter(Boolean);
  const rows = indexOf(list);
  const catName = new Map(cats.map((c) => [c.id, c.name.toLowerCase()]));
  const scored = [];
  for (const row of rows) {
    let score = 0;
    for (const t of terms) {
      let s = 0;
      if (row.id === t) s = 120;
      else if (row.id.startsWith(t)) s = 80;
      else if (row.name === t) s = 100;
      else if (row.name.startsWith(t)) s = 60;
      else if (row.name.includes(t)) s = 40;
      else if (row.id.includes(t)) s = 32;
      else if (row.aka.includes(t)) s = 26;
      else if (row.desc.includes(t)) s = 14;
      else if ((catName.get(row.op.cat) || "").includes(t)) s = 8;
      if (!s) { score = 0; break; }
      score += s;
    }
    if (score > 0) scored.push({ op: row.op, score, i: row.i });
  }
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.map((x) => x.op);
}
