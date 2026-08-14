/** A small, dependency-free force-directed layout — every node repels every other node (so
 *  unrelated cards spread apart), edges act as springs pulling their two ends toward an ideal
 *  length (so related cards cluster), and a gentle pull toward center keeps the whole thing from
 *  drifting off-canvas. Runs for a fixed number of ticks and settles, the same "simulate then
 *  freeze" approach Obsidian's own graph view uses, rather than running forever. */

export interface GraphNode {
  id: string
  x: number
  y: number
  vx: number
  vy: number
}

export interface GraphEdge {
  source: string
  target: string
  /** How many distinct relations connect this pair (e.g. sharing both a subfolder AND its parent
   *  folder counts twice) — higher weight pulls the pair closer together, so cards in the exact
   *  same folder end up visibly tighter than cards that only share a distant common ancestor.
   *  Defaults to 1 if omitted. */
  weight?: number
}

const REPULSION = 2200
const SPRING = 0.02
const IDEAL_EDGE_LENGTH = 90
const CENTER_PULL = 0.012
const DAMPING = 0.85

/** Circle layout as the starting position — an arbitrary-but-stable arrangement so the simulation
 *  isn't untangling total chaos from an all-nodes-at-origin or fully random start. */
export function initializeNodes(ids: string[], width: number, height: number): Map<string, GraphNode> {
  const nodes = new Map<string, GraphNode>()
  const cx = width / 2
  const cy = height / 2
  const radius = Math.min(width, height) * 0.35
  ids.forEach((id, i) => {
    const angle = (i / Math.max(1, ids.length)) * Math.PI * 2
    nodes.set(id, { id, x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle), vx: 0, vy: 0 })
  })
  return nodes
}

/** Advances the simulation by one step, mutating node positions/velocities in place. */
export function tick(nodes: Map<string, GraphNode>, edges: GraphEdge[], width: number, height: number): void {
  const list = [...nodes.values()]
  const cx = width / 2
  const cy = height / 2

  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i]
      const b = list[j]
      const dx = a.x - b.x
      const dy = a.y - b.y
      const distSq = Math.max(1, dx * dx + dy * dy)
      const dist = Math.sqrt(distSq)
      const force = REPULSION / distSq
      const fx = (dx / dist) * force
      const fy = (dy / dist) * force
      a.vx += fx
      a.vy += fy
      b.vx -= fx
      b.vy -= fy
    }
  }

  for (const edge of edges) {
    const a = nodes.get(edge.source)
    const b = nodes.get(edge.target)
    if (!a || !b) continue
    const weight = edge.weight ?? 1
    // A higher weight shortens the target distance (capped so heavily-weighted pairs don't
    // collide) and stiffens the spring — both push a strongly-related pair visibly closer
    // together than a pair that's only weakly related.
    const idealLength = Math.max(30, IDEAL_EDGE_LENGTH - (weight - 1) * 20)
    const dx = b.x - a.x
    const dy = b.y - a.y
    const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy))
    const force = (dist - idealLength) * SPRING * Math.min(2, weight)
    const fx = (dx / dist) * force
    const fy = (dy / dist) * force
    a.vx += fx
    a.vy += fy
    b.vx -= fx
    b.vy -= fy
  }

  for (const node of list) {
    node.vx += (cx - node.x) * CENTER_PULL
    node.vy += (cy - node.y) * CENTER_PULL
    node.vx *= DAMPING
    node.vy *= DAMPING
    node.x += node.vx
    node.y += node.vy
  }
}

/** Sum of squared velocities across every node — used to detect when the simulation has settled
 *  (stop ticking once this drops below a threshold) instead of always running a fixed count. */
export function totalKineticEnergy(nodes: Map<string, GraphNode>): number {
  let sum = 0
  for (const n of nodes.values()) sum += n.vx * n.vx + n.vy * n.vy
  return sum
}
