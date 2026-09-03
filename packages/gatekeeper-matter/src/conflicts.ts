// Conflict check at intake (WP-16), the pure part: does a party name match any matter's title,
// client, or case-map entity across the firm? Names are normalized (case, punctuation, honorifics,
// accents), and a partial match on a distinctive surname counts, so "Rao" finds "Dr. Anand Rao"
// but "Dr." finds nothing.

export type PartyNames = {
  matterId: string;
  title: string;
  clientName: string;
  ownerUserId: string | null;
  entities: { name: string; kind: string }[];
};

export type ConflictHit = {
  matterId: string;
  title: string;
  ownerUserId: string | null;
  /** The name on that matter the query matched. */
  matched: string;
  /** Where it matched: the client, the matter's title, or a case-map entity of this kind. */
  role: "client" | "title" | string;
  /** The query name that matched. */
  query: string;
};

const HONORIFICS = new Set(["dr", "mr", "mrs", "ms", "mx", "prof", "professor", "sir", "esq", "phd", "md", "jr", "sr", "ii", "iii", "the", "of", "and", "inc", "llc", "ltd", "corp", "co"]);

export function normalizeName(s: string): string[] {
  // Periods vanish before the split so "Ph.D." and "Dr." stay one token each and match the list.
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\./g, "")
    .replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(w => w.length > 1 && !HONORIFICS.has(w));
}

/** True when the query's distinctive words all appear in the candidate, or the candidate's in the query. */
export function namesMatch(query: string, candidate: string): boolean {
  const q = normalizeName(query); const c = normalizeName(candidate);
  if (q.length === 0 || c.length === 0) return false;
  const cs = new Set(c); const qs = new Set(q);
  const qInC = q.every(w => cs.has(w));
  const cInQ = c.every(w => qs.has(w));
  // A single short common token ("lab", "robotics") must not count as a hit on its own.
  const distinctive = (ws: string[]) => ws.some(w => w.length >= 4);
  return (qInC && distinctive(q)) || (cInQ && distinctive(c));
}

export function findConflicts(queries: string[], matters: PartyNames[], options?: { excludeMatterId?: string }): ConflictHit[] {
  const hits: ConflictHit[] = [];
  const seen = new Set<string>();
  const push = (h: ConflictHit) => {
    const key = `${h.matterId}:${h.role}:${h.matched.toLowerCase()}:${h.query.toLowerCase()}`;
    if (!seen.has(key)) { seen.add(key); hits.push(h); }
  };
  for (const query of queries.map(s => s.trim()).filter(Boolean)) {
    for (const m of matters) {
      if (options?.excludeMatterId && m.matterId === options.excludeMatterId) continue;
      if (namesMatch(query, m.clientName)) push({ matterId: m.matterId, title: m.title, ownerUserId: m.ownerUserId, matched: m.clientName, role: "client", query });
      if (namesMatch(query, m.title)) push({ matterId: m.matterId, title: m.title, ownerUserId: m.ownerUserId, matched: m.title, role: "title", query });
      for (const e of m.entities) {
        if (namesMatch(query, e.name)) push({ matterId: m.matterId, title: m.title, ownerUserId: m.ownerUserId, matched: e.name, role: e.kind, query });
      }
    }
  }
  return hits;
}
