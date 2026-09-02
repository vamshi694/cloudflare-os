import { useCallback, useEffect, useMemo, useRef, useState, type WheelEvent, type PointerEvent } from 'react'
import type { RpcStub } from 'capnweb'
import type { CaseEntity, CaseMap, MatterDesk, Readiness } from '@gadgets/workshop-shared/legal'
import { useKumoToastManager } from '@cloudflare/kumo'
import { logRpcFailure } from '../../../rpcErrors'
import { WorkshopButton, WorkshopInput } from '../../WorkshopControls'
import { EmptyLine, Notice, StatusDot } from '../primitives'
import { useDeskData } from '../useMatterDesk'
import { tidy } from '../labels'
import { Dossier } from './Dossier'
import { H, KIND_COLOR, NEIGHBOR_N, OTHER_COLOR, SHOW_N, W, clipLabel, colorOf, computeLayout, edgesOf, fitTransform } from './layout'

/**
 * THE CASE MAP — the knowledge graph the firm reasons over, made explorable (Connected Papers'
 * grammar): entities sized by salience and colored by kind, linked when the same legal claim binds
 * them; hover isolates a neighborhood, click opens the entity's dossier. Layout is computed ONCE and
 * rendered still: motion only where the lawyer causes it (pan, zoom, hover).
 */
export function CaseMapTab({ desk }: { desk: RpcStub<MatterDesk> }) {
  const toasts = useKumoToastManager()
  const load = useCallback(() => desk.caseMap(), [desk])
  const { data: map, failed, reload } = useDeskData<CaseMap>(load, { pollMs: 15000 })
  const loadReadiness = useCallback(() => desk.readiness(), [desk])
  const readiness = useDeskData<Readiness>(loadReadiness, {})
  const criteria = useMemo(() => (readiness.data?.sections ?? []).map((s) => ({ key: s.key, title: s.title })), [readiness.data])

  const [selId, setSelId] = useState<string | null>(null)
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [rebuilding, setRebuilding] = useState(false)

  const rebuild = async () => {
    setRebuilding(true)
    try {
      await desk.rebuildKnowledge()
      reload()
    } catch (err) {
      logRpcFailure('Failed to start the rebuild:', err)
      toasts.add({ title: "The rebuild didn't start. What the firm knows is unchanged — try again.", variant: 'error' })
    } finally {
      setRebuilding(false)
    }
  }

  if (map === null) {
    if (failed) return <Notice title="The case map couldn't be read just now." body="What the firm knows is unchanged — this view keeps retrying." />
    return <div className="skeleton h-[560px]" />
  }
  if (map.entities.length === 0) {
    return (
      <div className="space-y-3">
        {map.building ? (
          <p className="m-0 flex items-center gap-2 text-[13.5px] text-kumo-default"><StatusDot tone="working" className="breathe" /> The firm is building the case knowledge — this map fills in as it works.</p>
        ) : (
          <EmptyLine title="No case knowledge yet." body={map.note ?? 'The map builds itself as the firm reads documents.'} />
        )}
        {!map.building && (
          <WorkshopButton className="!h-8" onClick={() => void rebuild()} disabled={rebuilding}>
            {rebuilding ? 'Starting…' : map.fromDocuments === 0 ? 'Build it now' : 'Build it again'}
          </WorkshopButton>
        )}
      </div>
    )
  }

  const selected = map.entities.find((e) => e.id === selId) ?? null
  const legend = [...Object.entries(KIND_COLOR), ['everything else', OTHER_COLOR]] as [string, string][]
  const matches = query.trim() ? map.entities.filter((e) => e.name.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 40) : []

  return (
    <div className="space-y-3">
      {failed && <p className="m-0 text-[12.5px] italic text-kumo-subtle">Not updating right now — showing the last view that loaded.</p>}
      {map.building && <p className="m-0 flex items-center gap-2 text-[12.5px] text-kumo-subtle"><StatusDot tone="working" className="breathe" /> The case knowledge is being rebuilt — this map refreshes when it completes.</p>}
      <div className="grid gap-4 lg:grid-cols-[200px_minmax(0,1fr)] xl:grid-cols-[200px_minmax(0,1fr)_330px]">
        <aside className="space-y-4">
          <div>
            <WorkshopInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find an entity…" className="w-full !h-8" />
            {matches.length > 0 && (
              <ul className="m-0 mt-1.5 max-h-[240px] list-none space-y-0.5 overflow-y-auto p-0">
                {matches.map((e) => (
                  <li key={e.id}>
                    <button type="button" onClick={() => { setSelId(e.id); setQuery('') }} className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left text-[12.5px] text-kumo-default hover:bg-kumo-tint">
                      <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: colorOf(e.kind) }} />
                      <span className="min-w-0 truncate">{e.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="docket m-0 mb-1.5">Legend</p>
            <ul className="m-0 grid list-none grid-cols-2 gap-x-2 gap-y-1 p-0">
              {legend.map(([k, c]) => (
                <li key={k} className="flex items-center gap-1.5 text-[11.5px] text-kumo-subtle">
                  <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: c }} />
                  <span className="min-w-0 truncate">{tidy(k)}</span>
                </li>
              ))}
            </ul>
          </div>
          <WorkshopButton className="!h-8 w-full justify-center" onClick={() => void rebuild()} disabled={rebuilding || map.building}>
            {map.building ? 'Rebuilding…' : rebuilding ? 'Starting…' : 'Rebuild the case knowledge'}
          </WorkshopButton>
        </aside>
        <MapCanvas map={map} selId={selId} hoverId={hoverId} onSelect={setSelId} onHover={setHoverId} />
        <aside className="hidden overflow-hidden rounded-[14px] border border-kumo-line bg-kumo-base xl:block">
          <Dossier desk={desk} map={map} selected={selected} criteria={criteria} onSelect={setSelId} onChanged={reload} />
        </aside>
      </div>
      {selected && (
        <div className="overflow-hidden rounded-[14px] border border-kumo-line bg-kumo-base xl:hidden">
          <Dossier desk={desk} map={map} selected={selected} criteria={criteria} onSelect={setSelId} onChanged={reload} />
        </div>
      )}
    </div>
  )
}

function MapCanvas({ map, selId, hoverId, onSelect, onHover }: { map: CaseMap; selId: string | null; hoverId: string | null; onSelect: (id: string | null) => void; onHover: (id: string | null) => void }) {
  const host = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 800, h: 560 })
  const [view, setView] = useState<{ k: number; tx: number; ty: number } | null>(null)
  const drag = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null)

  useEffect(() => {
    const el = host.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: Math.max(480, Math.min(720, el.clientWidth * 0.68)) }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const live = useMemo(() => map.claims.filter((c) => !c.removed), [map.claims])
  const shown = useMemo(() => {
    const sorted = [...map.entities].sort((a, b) => b.salience - a.salience)
    const base = sorted.slice(0, SHOW_N)
    const ids = new Set(base.map((e) => e.id))
    if (selId && !ids.has(selId)) {
      const sel = map.entities.find((e) => e.id === selId)
      if (sel) {
        base.push(sel)
        ids.add(selId)
      }
    }
    if (selId) {
      const neigh = new Set<string>()
      for (const c of live) if (c.entityIds.includes(selId)) c.entityIds.forEach((id) => neigh.add(id))
      sorted.filter((e) => neigh.has(e.id) && !ids.has(e.id)).slice(0, NEIGHBOR_N).forEach((e) => { base.push(e); ids.add(e.id) })
    }
    return base
  }, [map.entities, live, selId])

  const edges = useMemo(() => edgesOf(live, new Set(shown.map((e) => e.id))), [live, shown])
  const placed = useMemo(() => computeLayout(shown, edges), [shown, edges])
  const pos = useMemo(() => new Map(placed.map((p) => [p.id, p])), [placed])
  const byId = useMemo(() => new Map(map.entities.map((e) => [e.id, e])), [map.entities])

  useEffect(() => setView(fitTransform(placed, size.w, size.h)), [placed, size.w, size.h])

  const focusId = hoverId ?? selId
  const neighborhood = useMemo(() => {
    if (!focusId) return null
    const s = new Set<string>([focusId])
    for (const e of edges) {
      if (e.a === focusId) s.add(e.b)
      if (e.b === focusId) s.add(e.a)
    }
    return s
  }, [focusId, edges])

  const onWheel = (e: WheelEvent<SVGSVGElement>) => {
    if (!view) return
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const factor = Math.exp(-e.deltaY * 0.0015)
    const k = Math.min(4, Math.max(0.3, view.k * factor))
    setView({ k, tx: mx - ((mx - view.tx) / view.k) * k, ty: my - ((my - view.ty) / view.k) * k })
  }
  const onDown = (e: PointerEvent<SVGSVGElement>) => {
    if (!view) return
    drag.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!drag.current || !view) return
    setView({ k: view.k, tx: drag.current.tx + (e.clientX - drag.current.x), ty: drag.current.ty + (e.clientY - drag.current.y) })
  }
  const onUp = (e: PointerEvent<SVGSVGElement>) => {
    const moved = drag.current && (Math.abs(e.clientX - drag.current.x) > 3 || Math.abs(e.clientY - drag.current.y) > 3)
    drag.current = null
    if (!moved && (e.target as Element).tagName === 'svg') onSelect(null)
  }

  const claimsOf = (e: CaseEntity) => live.filter((c) => c.entityIds.includes(e.id)).length

  return (
    <div ref={host} className="min-w-0">
      <div className="overflow-hidden rounded-[14px] border border-kumo-line bg-kumo-base">
        <svg
          width={size.w}
          height={size.h}
          viewBox={`0 0 ${size.w} ${size.h}`}
          className="block cursor-grab touch-none select-none active:cursor-grabbing"
          onWheel={onWheel}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
        >
          <defs>
            <filter id="legal-node-shadow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="2" stdDeviation="2.5" floodColor="#1d1d1f" floodOpacity="0.18" />
            </filter>
          </defs>
          {view && (
            <g transform={`translate(${view.tx} ${view.ty}) scale(${view.k})`}>
              {edges.map((e) => {
                const a = pos.get(e.a)
                const b = pos.get(e.b)
                if (!a || !b) return null
                const inFocus = neighborhood ? neighborhood.has(e.a) && neighborhood.has(e.b) && (e.a === focusId || e.b === focusId) : false
                const opacity = !neighborhood ? 0.07 : inFocus ? 0.32 : 0.03
                return <line key={`${e.a}|${e.b}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#1d1d1f" strokeWidth={Math.min(2.5, 0.6 + e.w * 0.35)} opacity={opacity} />
              })}
              {placed.map((p) => {
                const e = byId.get(p.id)
                if (!e) return null
                const dim = neighborhood ? !neighborhood.has(p.id) : false
                const sel = p.id === selId
                return (
                  <g key={p.id} opacity={dim ? 0.25 : 1} onMouseEnter={() => onHover(p.id)} onMouseLeave={() => onHover(null)} onClick={(ev) => { ev.stopPropagation(); onSelect(p.id) }} className="cursor-pointer">
                    <title>{`${e.name} · ${tidy(e.kind)} · ${claimsOf(e)} claims${e.locked ? ' · corrected by you' : ''}`}</title>
                    <circle cx={p.x} cy={p.y} r={p.r} fill={colorOf(e.kind)} fillOpacity={0.9} stroke={sel ? '#3d6bce' : '#ffffff'} strokeWidth={sel ? 3.5 : 2} filter="url(#legal-node-shadow)" />
                    {e.locked && <circle cx={p.x} cy={p.y} r={p.r + 4.5} fill="none" stroke="#3d6bce" strokeWidth={1.2} strokeDasharray="3 3" />}
                  </g>
                )
              })}
              {placed.map((p) => {
                const e = byId.get(p.id)
                if (!e || (neighborhood && !neighborhood.has(p.id))) return null
                return (
                  <text key={`l-${p.id}`} x={p.x} y={p.y + p.r + 13} textAnchor="middle" fontSize={11.5} fill="#1d1d1f" stroke="#ffffff" strokeWidth={3.5} paintOrder="stroke" className="pointer-events-none">
                    {clipLabel(e.name)}
                  </text>
                )
              })}
            </g>
          )}
        </svg>
        <p className="tnum m-0 border-t border-kumo-line px-4 py-2 text-[11.5px] text-kumo-inactive">
          The {shown.length} biggest of {map.entities.length} entities · search finds the rest · scroll to zoom, drag to pan
        </p>
      </div>
    </div>
  )
}

export { W as MAP_W, H as MAP_H }
