import type { CaseClaim, CaseEntity, EntityKind } from '@gadgets/workshop-shared/legal'

/** Fixed kind→hue mapping (validated categorical palette; never cycled). Everything else = grey. */
export const KIND_COLOR: Record<Exclude<EntityKind, 'other'>, string> = {
  person: '#3d6bce',
  organization: '#2f8a4c',
  project: '#c05c8a',
  work_product: '#b07d1e',
  publication: '#1f8f7a',
  achievement: '#c2622e',
  credential: '#6455b8',
}
export const OTHER_COLOR = '#8a8a8f'

export function colorOf(kind: EntityKind): string {
  return (KIND_COLOR as Record<string, string>)[kind] ?? OTHER_COLOR
}

export const W = 1200
export const H = 800
/** Few, big, all-labeled soft circles that fill the frame. */
export const SHOW_N = 28
export const NEIGHBOR_N = 22

export type Placed = { id: string; x: number; y: number; r: number }
export type Edge = { a: string; b: string; w: number }

export function radiusOf(salience: number, maxSalience: number): number {
  const s = maxSalience > 0 ? salience / maxSalience : 0
  return 16 + 36 * Math.sqrt(Math.max(0, s))
}

/** Edges: one per pair of entities that share a claim, weighted by how many claims bind them. */
export function edgesOf(claims: CaseClaim[], ids: Set<string>): Edge[] {
  const weights = new Map<string, Edge>()
  for (const c of claims) {
    if (c.removed) continue
    const members = c.entityIds.filter((id) => ids.has(id))
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const [a, b] = members[i] < members[j] ? [members[i], members[j]] : [members[j], members[i]]
        const key = `${a}|${b}`
        const e = weights.get(key)
        if (e) e.w += 1
        else weights.set(key, { a, b, w: 1 })
      }
    }
  }
  return [...weights.values()]
}

/**
 * A deterministic force layout run to rest synchronously: golden-angle seed by salience rank,
 * 260 iterations of pairwise repulsion + claim-springs (rest length grows with the radii so big
 * nodes breathe instead of stacking) + center gravity, velocity damped 0.82. No rAF, no loop.
 */
export function computeLayout(entities: CaseEntity[], edges: Edge[]): Placed[] {
  const sorted = [...entities].sort((a, b) => b.salience - a.salience)
  const maxS = sorted[0]?.salience ?? 1
  const golden = Math.PI * (3 - Math.sqrt(5))
  const nodes = sorted.map((e, i) => {
    const t = i * golden
    const rad = 40 + 22 * Math.sqrt(i)
    return { id: e.id, x: W / 2 + Math.cos(t) * rad, y: H / 2 + Math.sin(t) * rad * 0.7, vx: 0, vy: 0, r: radiusOf(e.salience, maxS) }
  })
  const index = new Map(nodes.map((n, i) => [n.id, i]))
  const springs = edges.filter((e) => index.has(e.a) && index.has(e.b)).map((e) => ({ a: index.get(e.a)!, b: index.get(e.b)!, w: e.w }))

  for (let iter = 0; iter < 260; iter++) {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const A = nodes[i]
        const B = nodes[j]
        let dx = B.x - A.x
        let dy = B.y - A.y
        let d2 = dx * dx + dy * dy
        if (d2 < 1) {
          dx = (i - j) * 0.37
          dy = (j - i) * 0.61
          d2 = dx * dx + dy * dy
        }
        const d = Math.sqrt(d2)
        const min = A.r + B.r + 18
        const force = (2200 / d2) * (d < min ? 4 : 1)
        const fx = (dx / d) * force
        const fy = (dy / d) * force
        A.vx -= fx
        A.vy -= fy
        B.vx += fx
        B.vy += fy
      }
    }
    for (const s of springs) {
      const A = nodes[s.a]
      const B = nodes[s.b]
      const dx = B.x - A.x
      const dy = B.y - A.y
      const d = Math.sqrt(dx * dx + dy * dy) || 1
      const rest = 70 + (A.r + B.r) * 0.9
      const k = 0.012 * Math.min(3, s.w)
      const f = (d - rest) * k
      const fx = (dx / d) * f
      const fy = (dy / d) * f
      A.vx += fx
      A.vy += fy
      B.vx -= fx
      B.vy -= fy
    }
    for (const n of nodes) {
      n.vx += (W / 2 - n.x) * 0.022
      n.vy += (H / 2 - n.y) * 0.032
      n.vx *= 0.82
      n.vy *= 0.82
      n.x += n.vx
      n.y += n.vy
    }
  }
  return nodes.map(({ id, x, y, r }) => ({ id, x, y, r }))
}

/** Auto-fit on 3rd/97th percentile bounds so one flung outlier can't zoom the map to a speck. */
export function fitTransform(placed: Placed[], viewW: number, viewH: number): { k: number; tx: number; ty: number } {
  if (placed.length === 0) return { k: 1, tx: 0, ty: 0 }
  const xs = placed.map((p) => p.x).sort((a, b) => a - b)
  const ys = placed.map((p) => p.y).sort((a, b) => a - b)
  const q = (arr: number[], p: number) => arr[Math.min(arr.length - 1, Math.max(0, Math.floor(p * (arr.length - 1))))]
  const pad = 40
  const maxR = Math.max(...placed.map((p) => p.r))
  const x0 = q(xs, 0.03) - maxR - pad
  const x1 = q(xs, 0.97) + maxR + pad
  const y0 = q(ys, 0.03) - maxR - pad
  const y1 = q(ys, 0.97) + maxR + pad
  // A handful of nodes must not balloon to fill the frame: below six entities the map stays at
  // natural size, so three circles read as three circles, not as a wall.
  const maxK = placed.length < 6 ? 1 : 2.2
  const k = Math.min(maxK, viewW / Math.max(1, x1 - x0), viewH / Math.max(1, y1 - y0))
  return { k, tx: (viewW - (x0 + x1) * k) / 2, ty: (viewH - (y0 + y1) * k) / 2 }
}

export function clipLabel(name: string, max = 26): string {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name
}
