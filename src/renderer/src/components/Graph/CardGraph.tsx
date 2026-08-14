import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { CardRecord, DocumentRecord, FolderRecord } from '../../../../shared/types'
import { useUiStore } from '../../state/uiStore'
import { initializeNodes, tick, totalKineticEnergy, type GraphEdge, type GraphNode } from '../../utils/forceGraph'

const WIDTH = 900
const HEIGHT = 560
const MAX_TICKS = 350
const SETTLE_THRESHOLD = 0.02
const DOCUMENT_NODE_PREFIX = 'doc:'
const FOLDER_NODE_PREFIX = 'folder:'

// A light magnetic pull toward the live cursor position, applied only to the single nearest node
// (not graph-aware, not every node in range) so it reads as one thread being drawn toward the
// cursor rather than the whole web lurching at once — deliberately subtle, a visual touch rather
// than a real drag interaction. Once a node is caught, it's driven kinematically — each frame it
// glides a fixed fraction (FOLLOW_RATE) of the remaining distance toward the cursor, then its
// velocity is zeroed — rather than by adding force and letting the normal spring/repulsion physics
// carry it. That distinction is the whole point: a force-driven node fighting the springs settles
// into an equilibrium *near* the cursor that it visibly jitters around; a glide is a pure monotonic
// decay toward the target with nothing to oscillate about, so it can track the cursor continuously
// with no jitter at any distance, not just once "close enough." A caught node lets go either when
// the cursor leaves the canvas, or when the cursor has moved more than the (user-adjustable) detach
// distance since the moment it was caught (like a rubber band with a max stretch, anchored to where
// the drag started rather than the node's permanent resting spot — see catchAnchorRef) — either way
// it's handed back to the normal simulation to spring back toward rest.
const MAGNET_RADIUS = 110

// A large detach budget (see below) is great for not accidentally dropping a node while merely
// passing near another one, but it also makes it hard to *deliberately* swap: moving the cursor
// straight onto a different node shouldn't require dragging the old one across the whole budget
// first. SWAP_RADIUS is a much tighter, separate check — evaluated every frame something's already
// caught — that hands the catch straight to another node the instant the cursor is genuinely on top
// of it, bypassing the detach budget entirely. SWAP_MARGIN requires that other node to be closer to
// the cursor than the currently-held one by a real amount, not just marginally — without this,
// two nodes close enough together that both sit inside SWAP_RADIUS at once could flap back and
// forth on sub-pixel physics noise; verified via a standalone stress test that this margin (plus
// requiring a real straight-line cursor path rather than an adversarial oscillating one) eliminates
// that alternation while still swapping in ~8 frames for a genuine deliberate move onto another node.
const SWAP_RADIUS = 25
const SWAP_MARGIN = 10

// Both left user-adjustable via sliders rather than fixed constants — same bare-localStorage
// pattern as VideoPlayer's engine dropdowns. Detach distance already went through two rounds of
// "detach too late" feedback; follow rate (how large a fraction of the remaining distance the
// caught node closes each frame — higher reads as a tighter, more rigid pull) went through one
// round of "too strong." A slider settles both once instead of another code change each time.
const FOLLOW_RATE_KEY = 'graph-follow-rate'
const DEFAULT_FOLLOW_RATE = 0.12
const MIN_FOLLOW_RATE = 0.05
const MAX_FOLLOW_RATE = 0.5

// The slider's floor is intentionally kept at or above MAGNET_RADIUS, not below it. Letting it drop
// lower creates a hysteresis inversion — easier to lose a node than to catch one — which is what
// caused a real flip-flop bug: passing near a second node while the drag budget from the first was
// already exhausted would bounce between the two every frame, occasionally settling on the farther
// one simply because the nearer one was sitting in its post-release cooldown. Verified with a
// standalone sweep test: at budget=30 (old default, below MAGNET_RADIUS=110) a 300-frame cursor
// sweep produced 10 direct node-to-node swaps, several of them repeated A<->B<->A alternation;
// raising the budget to comfortably exceed MAGNET_RADIUS collapsed that to 0-1 swaps (a single
// legitimate handoff between genuinely different neighborhoods, not jitter).
const DETACH_DISTANCE_KEY = 'graph-detach-distance'
const DEFAULT_DETACH_DISTANCE = 180
const MIN_DETACH_DISTANCE = 120
const MAX_DETACH_DISTANCE = 350

function readStoredFollowRate(): number {
  const stored = Number(window.localStorage.getItem(FOLLOW_RATE_KEY))
  return stored >= MIN_FOLLOW_RATE && stored <= MAX_FOLLOW_RATE ? stored : DEFAULT_FOLLOW_RATE
}

function readStoredDetachDistance(): number {
  const stored = Number(window.localStorage.getItem(DETACH_DISTANCE_KEY))
  return stored >= MIN_DETACH_DISTANCE && stored <= MAX_DETACH_DISTANCE ? stored : DEFAULT_DETACH_DISTANCE
}

interface NodeMeta {
  kind: 'card' | 'document' | 'folder'
  label: string
  folderId: string | null
  card?: CardRecord
}

function documentNodeId(documentId: string): string {
  return DOCUMENT_NODE_PREFIX + documentId
}

function folderNodeId(folderId: string): string {
  return FOLDER_NODE_PREFIX + folderId
}

/** Builds both the edge list and per-node display info in one pass. Everything is a proper hub
 *  node — a card connects to its own folder and to each source document it's from; a folder
 *  connects to its own parent folder. Clustering falls out of that hierarchy on its own. */
function buildGraph(
  cards: CardRecord[],
  folders: FolderRecord[]
): { nodeIds: string[]; edges: GraphEdge[]; meta: Map<string, NodeMeta> } {
  const weights = new Map<string, number>()
  const meta = new Map<string, NodeMeta>()
  const folderById = new Map(folders.map((f) => [f.id, f]))

  function addWeight(a: string, b: string, amount: number): void {
    if (a === b) return
    const key = a < b ? `${a}|${b}` : `${b}|${a}`
    weights.set(key, (weights.get(key) ?? 0) + amount)
  }

  for (const card of cards) {
    meta.set(card.id, { kind: 'card', label: card.front.trim() || 'Untitled', folderId: card.folderId, card })
  }

  const usedFolderIds = new Set<string>()
  for (const card of cards) {
    if (!card.folderId) continue
    usedFolderIds.add(card.folderId)
    addWeight(card.id, folderNodeId(card.folderId), 2)
  }
  for (const folderId of usedFolderIds) {
    let current = folderById.get(folderId)
    while (current?.parentId) {
      usedFolderIds.add(current.parentId)
      addWeight(folderNodeId(current.id), folderNodeId(current.parentId), 1.5)
      current = folderById.get(current.parentId)
    }
  }
  for (const folderId of usedFolderIds) {
    meta.set(folderNodeId(folderId), { kind: 'folder', label: folderById.get(folderId)?.name ?? 'Unknown folder', folderId })
  }

  for (const card of cards) {
    const documentIds = new Set(card.sources.map((s) => s.documentId))
    for (const documentId of documentIds) {
      const nodeId = documentNodeId(documentId)
      if (!meta.has(nodeId)) meta.set(nodeId, { kind: 'document', label: '', folderId: null })
      addWeight(card.id, nodeId, 2)
    }
  }

  const edges: GraphEdge[] = [...weights.entries()].map(([key, weight]) => {
    const [source, target] = key.split('|')
    return { source, target, weight }
  })

  return { nodeIds: [...meta.keys()], edges, meta }
}

export function CardGraph({
  cards,
  folders,
  documents
}: {
  cards: CardRecord[]
  folders: FolderRecord[]
  documents: DocumentRecord[]
}): JSX.Element {
  const focusCard = useUiStore((s) => s.focusCard)
  const setView = useUiStore((s) => s.setView)
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [hovered, setHovered] = useState<{ id: string; x: number; y: number } | null>(null)
  const [, forceRender] = useState(0)

  const nodesRef = useRef<Map<string, GraphNode>>(new Map())
  const rafRef = useRef<number | null>(null)
  // The cursor's position in SVG user-space (not raw client pixels) while it's over the canvas —
  // null when the pointer isn't over it, which is also the loop's "let go and settle back" signal.
  const cursorRef = useRef<{ x: number; y: number } | null>(null)
  // Which node (if any) has been "caught" by the magnet and is currently pinned to the cursor.
  const caughtNodeIdRef = useRef<string | null>(null)
  // The node (if any) that was JUST released — excluded from being re-caught until the cursor
  // actually moves outside MAGNET_RADIUS of it at least once. Without this, releasing a node while
  // it's still sitting right at the cursor (the usual case — it was just glued there) makes
  // nearestNode immediately find that same node again and re-catch it in the same or very next
  // frame, which reads as "it never lets go" — especially moving the cursor slowly, since the node
  // never gets a chance to fall meaningfully far behind before the next frame's search runs.
  const releasedNodeIdRef = useRef<string | null>(null)
  // The cursor's own position at the moment the currently-caught node was caught — the detach check
  // measures drag distance from *this*, not from the node's eternal resting position. Measuring from
  // rest broke down as soon as the cursor wandered away from where it started: catching a totally
  // different node whose rest position is far from the cursor's current neighborhood would fail the
  // distance check on the very next frame regardless of how briefly it had been held, causing a
  // rapid catch/detach/catch-a-different-node flutter. Anchoring to the catch moment instead means
  // "how far has this specific drag moved," which starts at ~0 for every fresh catch no matter where
  // the cursor happens to be on the canvas.
  const catchAnchorRef = useRef<{ x: number; y: number } | null>(null)

  const [detachDistance, setDetachDistance] = useState<number>(readStoredDetachDistance)
  const [followRate, setFollowRate] = useState<number>(readStoredFollowRate)
  // The rAF loop below is a plain function re-created each render, but once scheduled it keeps
  // recursing on that same closure rather than picking up newer ones — so these need refs, not the
  // state values directly, to see a mid-drag slider change on the very next frame instead of only
  // after the current catch-and-release cycle ends.
  const detachDistanceRef = useRef(detachDistance)
  useEffect(() => {
    detachDistanceRef.current = detachDistance
  }, [detachDistance])
  const followRateRef = useRef(followRate)
  useEffect(() => {
    followRateRef.current = followRate
  }, [followRate])

  function updateDetachDistance(value: number): void {
    setDetachDistance(value)
    window.localStorage.setItem(DETACH_DISTANCE_KEY, String(value))
  }

  function updateFollowRate(value: number): void {
    setFollowRate(value)
    window.localStorage.setItem(FOLLOW_RATE_KEY, String(value))
  }

  // The settled resting layout — recomputed only when the underlying data changes. This is the
  // *rest state* the live simulation (nodesRef) returns to once the magnet lets go; see the
  // effect below that seeds nodesRef from it.
  const { restingNodes, edges, meta, refCounts } = useMemo(() => {
    const { nodeIds, edges, meta } = buildGraph(cards, folders)
    const nodeMap = initializeNodes(nodeIds, WIDTH, HEIGHT)
    for (let i = 0; i < MAX_TICKS; i++) {
      tick(nodeMap, edges, WIDTH, HEIGHT)
      if (i % 20 === 0 && i > 40 && totalKineticEnergy(nodeMap) < SETTLE_THRESHOLD) break
    }
    const refCounts = new Map<string, number>()
    for (const edge of edges) {
      refCounts.set(edge.source, (refCounts.get(edge.source) ?? 0) + 1)
      refCounts.set(edge.target, (refCounts.get(edge.target) ?? 0) + 1)
    }
    return { restingNodes: nodeMap, edges, meta, refCounts }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, folders])

  // Seed the live simulation from the resting layout whenever it changes (new/removed cards,
  // folders, etc.) — a fresh clone, so nudging the live copy with the magnet never mutates the
  // memoized resting positions themselves.
  useEffect(() => {
    const clone = new Map<string, GraphNode>()
    for (const [id, n] of restingNodes) clone.set(id, { ...n })
    nodesRef.current = clone
    forceRender((v) => v + 1)
  }, [restingNodes])

  // Stop the magnet loop on unmount so it doesn't keep ticking (and calling setState) after this
  // component is gone — e.g. switching back to the Dashboard tab.
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  function nearestNode(cursor: { x: number; y: number }, excludeId: string | null): { node: GraphNode; dist: number } | null {
    let nearest: GraphNode | null = null
    let nearestDist = Infinity
    for (const node of nodesRef.current.values()) {
      if (node.id === excludeId) continue
      const dist = Math.hypot(cursor.x - node.x, cursor.y - node.y)
      if (dist < nearestDist) {
        nearestDist = dist
        nearest = node
      }
    }
    return nearest ? { node: nearest, dist: nearestDist } : null
  }

  function runMagnetLoop(): void {
    const cursor = cursorRef.current
    // Computed once per frame (if a node is caught) and applied twice — see below for why.
    let glideTarget: { id: string; x: number; y: number } | null = null

    if (cursor) {
      // Lift the release-cooldown once the cursor has genuinely moved away from that node, not
      // just once it's been released — a node released right under a stationary cursor should stay
      // excluded until the cursor (or the node springing back under it) actually separates.
      const releasedId = releasedNodeIdRef.current
      if (releasedId) {
        const releasedNode = nodesRef.current.get(releasedId)
        const distFromReleased = releasedNode ? Math.hypot(cursor.x - releasedNode.x, cursor.y - releasedNode.y) : Infinity
        if (distFromReleased > MAGNET_RADIUS) releasedNodeIdRef.current = null
      }

      const caughtId = caughtNodeIdRef.current
      let caught = caughtId ? nodesRef.current.get(caughtId) : undefined

      if (caught) {
        // A deliberate swap onto a different node — see SWAP_RADIUS/SWAP_MARGIN above. Bypasses the
        // detach budget entirely, since this isn't "dragged too far," it's "aimed at something else."
        const distToCurrent = Math.hypot(cursor.x - caught.x, cursor.y - caught.y)
        const swapCandidate = nearestNode(cursor, caught.id)
        if (swapCandidate && swapCandidate.dist <= SWAP_RADIUS && swapCandidate.dist < distToCurrent - SWAP_MARGIN) {
          caughtNodeIdRef.current = swapCandidate.node.id
          catchAnchorRef.current = { x: cursor.x, y: cursor.y }
          releasedNodeIdRef.current = null
          caught = swapCandidate.node
        }
      }

      const anchor = caught ? catchAnchorRef.current : null
      const strayDistance = caught && anchor ? Math.hypot(cursor.x - anchor.x, cursor.y - anchor.y) : 0
      if (caught && strayDistance > detachDistanceRef.current) {
        // Dragged too far from where this drag started — let go instead of stretching it along
        // forever; it stays where it was and springs back like a normal release. Starts this node's
        // re-catch cooldown (see releasedNodeIdRef above). Uses caught.id, not the caughtId captured
        // at the top of this frame — a swap above may have already moved it on to a different node.
        caughtNodeIdRef.current = null
        releasedNodeIdRef.current = caught.id
        catchAnchorRef.current = null
        caught = undefined
      }
      if (!caught) {
        const found = nearestNode(cursor, releasedNodeIdRef.current)
        if (found && found.dist <= MAGNET_RADIUS) {
          caughtNodeIdRef.current = found.node.id
          caught = found.node
          catchAnchorRef.current = { x: cursor.x, y: cursor.y }
        }
      }
      if (caught) {
        glideTarget = {
          id: caught.id,
          x: caught.x + (cursor.x - caught.x) * followRateRef.current,
          y: caught.y + (cursor.y - caught.y) * followRateRef.current
        }
        caught.x = glideTarget.x
        caught.y = glideTarget.y
        caught.vx = 0
        caught.vy = 0
      }
    } else {
      caughtNodeIdRef.current = null
      catchAnchorRef.current = null
    }

    tick(nodesRef.current, edges, WIDTH, HEIGHT)

    // tick() just nudged the caught node too (repulsion/springs act on every node) — restore it to
    // this frame's already-computed glide target (not a second glide step, which would compound),
    // since the glide alone should drive it while caught, not a tug-of-war with the rest of the sim.
    if (glideTarget) {
      const node = nodesRef.current.get(glideTarget.id)
      if (node) {
        node.x = glideTarget.x
        node.y = glideTarget.y
        node.vx = 0
        node.vy = 0
      }
    }

    forceRender((v) => v + 1)
    // Keep looping while the magnet is actively held (cursor still over the canvas) or the graph
    // is still settling back from a recent release — stop only once both are false, so letting go
    // doesn't cut the spring-back animation short.
    const stillSettling = totalKineticEnergy(nodesRef.current) >= SETTLE_THRESHOLD
    if (cursorRef.current || stillSettling) {
      rafRef.current = requestAnimationFrame(runMagnetLoop)
    } else {
      rafRef.current = null
    }
  }

  function ensureMagnetLoopRunning(): void {
    if (rafRef.current === null) rafRef.current = requestAnimationFrame(runMagnetLoop)
  }

  /** Raw client coordinates -> the SVG's own user-space (the same 900x560 space node.x/y live in),
   *  accounting for the viewBox scaling — not a manual ratio calc, since getScreenCTM already
   *  accounts for exactly how the browser mapped the viewBox onto the element's rendered size. */
  function clientToSvgPoint(clientX: number, clientY: number): { x: number; y: number } | null {
    const svg = svgRef.current
    if (!svg) return null
    const ctm = svg.getScreenCTM()
    if (!ctm) return null
    const pt = svg.createSVGPoint()
    pt.x = clientX
    pt.y = clientY
    const transformed = pt.matrixTransform(ctm.inverse())
    return { x: transformed.x, y: transformed.y }
  }

  function handleSvgMouseMove(e: React.MouseEvent<SVGSVGElement>): void {
    const point = clientToSvgPoint(e.clientX, e.clientY)
    if (!point) return
    cursorRef.current = point
    ensureMagnetLoopRunning()
  }

  function handleSvgMouseLeave(): void {
    cursorRef.current = null
    caughtNodeIdRef.current = null
    releasedNodeIdRef.current = null
    catchAnchorRef.current = null
    setHovered(null)
  }

  if (cards.length === 0) {
    return <p style={{ color: 'var(--fg-muted)', fontSize: 'var(--font-sm)' }}>No cards yet — the graph fills in once you have some.</p>
  }

  const documentById = new Map(documents.map((d) => [d.id, d]))

  function labelFor(nodeId: string, info: NodeMeta): string {
    if (info.kind !== 'document') return info.label
    const doc = documentById.get(nodeId.slice(DOCUMENT_NODE_PREFIX.length))
    return doc?.filename ?? 'Unknown document'
  }

  function colorFor(info: NodeMeta): string {
    if (info.kind === 'document') return 'var(--accent)'
    if (!info.folderId) return 'var(--fg-faint)'
    const hue = folderHue(info.folderId)
    return info.kind === 'folder' ? `hsl(${hue}, 70%, 40%)` : `hsl(${hue}, 55%, 55%)`
  }

  function radiusFor(nodeId: string): number {
    return 7 + Math.min(10, (refCounts.get(nodeId) ?? 0) * 1.2)
  }

  function handleEnter(nodeId: string, e: React.MouseEvent): void {
    const containerRect = containerRef.current?.getBoundingClientRect()
    if (containerRect) setHovered({ id: nodeId, x: e.clientX - containerRect.left, y: e.clientY - containerRect.top })
  }

  function handleClick(info: NodeMeta): void {
    if (info.kind === 'card' && info.card) focusCard(info.card.id, info.card.folderId)
    else if (info.kind === 'folder' && info.folderId) setView({ type: 'folder', folderId: info.folderId })
  }

  const liveNodes = nodesRef.current

  return (
    <div>
      <p style={{ color: 'var(--fg-muted)', fontSize: 'var(--font-sm)', margin: '0 0 var(--space-3)' }}>
        Cards connect to their folder and to each source document; folders connect to their own parent folder. Move
        your cursor over the web to draw nearby nodes toward it. Click a card to jump to it, or a folder to open it.
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap', margin: '0 0 var(--space-3)' }}>
        <label htmlFor="graph-follow-rate" style={{ fontSize: 'var(--font-xs)', color: 'var(--fg-faint)' }}>
          Pull strength
        </label>
        <input
          id="graph-follow-rate"
          type="range"
          min={MIN_FOLLOW_RATE}
          max={MAX_FOLLOW_RATE}
          step={0.01}
          value={followRate}
          onChange={(e) => updateFollowRate(Number(e.target.value))}
          title="How tightly a caught node tracks the cursor — lower is softer/laggier, higher is snappier"
          style={{ width: 140 }}
        />
        <span style={{ fontSize: 'var(--font-xs)', color: 'var(--fg-faint)', width: 28, fontVariantNumeric: 'tabular-nums' }}>
          {Math.round(followRate * 100)}%
        </span>

        <span style={dividerStyle} />

        <label htmlFor="graph-detach-distance" style={{ fontSize: 'var(--font-xs)', color: 'var(--fg-faint)' }}>
          Detach distance
        </label>
        <input
          id="graph-detach-distance"
          type="range"
          min={MIN_DETACH_DISTANCE}
          max={MAX_DETACH_DISTANCE}
          step={5}
          value={detachDistance}
          onChange={(e) => updateDetachDistance(Number(e.target.value))}
          title="How far a caught node can be dragged from home before it lets go"
          style={{ width: 140 }}
        />
        <span style={{ fontSize: 'var(--font-xs)', color: 'var(--fg-faint)', width: 28, fontVariantNumeric: 'tabular-nums' }}>
          {detachDistance}
        </span>
      </div>
      <div ref={containerRef} style={{ position: 'relative' }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          onMouseMove={handleSvgMouseMove}
          onMouseLeave={handleSvgMouseLeave}
          style={{ width: '100%', height: 'auto', display: 'block', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', background: 'var(--bg)' }}
        >
          <g opacity={0.35}>
            {edges.map((edge, i) => {
              const a = liveNodes.get(edge.source)
              const b = liveNodes.get(edge.target)
              if (!a || !b) return null
              return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--fg-faint)" strokeWidth={1} />
            })}
          </g>
          <g>
            {[...liveNodes.values()].map((node) => {
              const info = meta.get(node.id)
              if (!info) return null
              const radius = radiusFor(node.id)
              const isHovered = hovered?.id === node.id
              const clickable = info.kind === 'card' || info.kind === 'folder'
              return (
                <g
                  key={node.id}
                  transform={`translate(${node.x}, ${node.y})`}
                  style={{ cursor: clickable ? 'pointer' : 'default' }}
                  onMouseEnter={(e) => handleEnter(node.id, e)}
                  onMouseLeave={() => setHovered(null)}
                  onClick={() => handleClick(info)}
                >
                  {info.kind === 'document' && (
                    <rect
                      x={-radius}
                      y={-radius}
                      width={radius * 2}
                      height={radius * 2}
                      rx={3}
                      fill={colorFor(info)}
                      fillOpacity={0.85}
                      stroke={isHovered ? 'var(--fg)' : 'var(--bg)'}
                      strokeWidth={isHovered ? 2 : 1.5}
                      style={{ transition: 'width 100ms ease, height 100ms ease' }}
                    />
                  )}
                  {info.kind === 'folder' && (
                    <rect
                      x={-radius}
                      y={-radius}
                      width={radius * 2}
                      height={radius * 2}
                      transform="rotate(45)"
                      fill={colorFor(info)}
                      stroke={isHovered ? 'var(--fg)' : 'var(--bg)'}
                      strokeWidth={isHovered ? 2 : 1.5}
                      style={{ transition: 'width 100ms ease, height 100ms ease' }}
                    />
                  )}
                  {info.kind === 'card' && (
                    <circle
                      r={isHovered ? radius + 2 : radius}
                      fill={colorFor(info)}
                      stroke={isHovered ? 'var(--fg)' : 'var(--bg)'}
                      strokeWidth={isHovered ? 2 : 1.5}
                      style={{ transition: 'r 100ms ease' }}
                    />
                  )}
                </g>
              )
            })}
          </g>
        </svg>
        {hovered &&
          (() => {
            const info = meta.get(hovered.id)
            if (!info) return null
            const icon = info.kind === 'document' ? '📄 ' : info.kind === 'folder' ? '📁 ' : ''
            return (
              <div style={{ ...tooltipStyle, left: hovered.x + 12, top: hovered.y + 12 }}>
                {icon}
                {labelFor(hovered.id, info)}
              </div>
            )
          })()}
      </div>
    </div>
  )
}

/** Stable per-folder hue so the same folder always gets the same color across renders — a simple
 *  string hash, not cryptographic, just needs to spread folder ids across the color wheel. */
function folderHue(folderId: string): number {
  let hash = 0
  for (let i = 0; i < folderId.length; i++) hash = (hash * 31 + folderId.charCodeAt(i)) >>> 0
  return hash % 360
}

const dividerStyle: CSSProperties = {
  width: 1,
  height: 18,
  background: 'var(--border)',
  flexShrink: 0
}

const tooltipStyle: CSSProperties = {
  position: 'absolute',
  maxWidth: 240,
  padding: '6px 8px',
  fontSize: 'var(--font-xs)',
  lineHeight: 1.3,
  background: 'var(--modal-bg)',
  color: 'var(--modal-fg)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  boxShadow: '0 4px 16px #00000030',
  pointerEvents: 'none',
  zIndex: 10
}
