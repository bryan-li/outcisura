/** Polished, springy scrolling for the main content pane and the sidebar list.
 *
 *  Two things, both driven from one document-level wheel listener:
 *   - Mouse wheels (which arrive as big discrete steps) glide: each notch moves a target and the real
 *     scroll position eases toward it, like YouTube or Chrome's own smooth scrolling.
 *   - Pushing past either end (mouse or trackpad) stretches the content and springs it back — the
 *     rubber-band feel macOS gives the whole page but Chromium doesn't give scrolling panels.
 *  Trackpad scrolling inside the panel is left to the browser, which already has momentum.
 *
 *  Skipped entirely for reduced-motion users, for pinch-zoom, for horizontal gestures, and whenever
 *  the pointer is over a nested scroller that can still move in that direction. */

const CONTAINER_SELECTOR = 'main, .sidebar-scroll'
/** Half-life-ish easing: the fraction of the remaining distance covered per second is 1 - e^(-k). */
const GLIDE_RATE = 14
const MAX_STRETCH = 84
const SPRING_STIFFNESS = 380
const SPRING_DAMPING = 28
const GESTURE_GAP_MS = 90

interface ScrollState {
  /** Where the glide is heading (mouse mode). */
  target: number
  /** The scrollTop we last wrote, so an outside change (scrollbar drag, scrollTo, page change) can be told apart. */
  lastWritten: number
  gliding: boolean
  stretch: number
  velocity: number
  springing: boolean
  lastWheelAt: number
  /** Decided at the start of each wheel gesture: true for a notched mouse wheel. */
  mouseGesture: boolean
  lastFrame: number
}

const states = new WeakMap<HTMLElement, ScrollState>()

function stateFor(el: HTMLElement): ScrollState {
  let s = states.get(el)
  if (!s) {
    s = { target: el.scrollTop, lastWritten: el.scrollTop, gliding: false, stretch: 0, velocity: 0, springing: false, lastWheelAt: 0, mouseGesture: false, lastFrame: 0 }
    states.set(el, s)
    // Any scroll we didn't cause (scrollbar drag, keyboard, scrollTo, navigating) resets the glide.
    el.addEventListener('scroll', () => {
      const st = states.get(el)!
      if (Math.abs(el.scrollTop - st.lastWritten) > 1.5) {
        st.target = el.scrollTop
        st.lastWritten = el.scrollTop
        st.gliding = false
      }
    })
  }
  return s
}

function maxScroll(el: HTMLElement): number {
  return Math.max(0, el.scrollHeight - el.clientHeight)
}

/** The element that gets stretched: the pane's own content, so its scrollbar and padding stay put. */
function stretchTarget(el: HTMLElement): HTMLElement | null {
  return el.firstElementChild instanceof HTMLElement ? el.firstElementChild : null
}

function applyStretch(el: HTMLElement, px: number): void {
  const t = stretchTarget(el)
  if (t) t.style.transform = Math.abs(px) < 0.05 ? '' : `translate3d(0, ${px.toFixed(2)}px, 0)`
}

/** True when something between the pointer and the container can itself scroll in this direction. */
function nestedScrollerHandles(start: EventTarget | null, container: HTMLElement, dy: number): boolean {
  let node = start instanceof HTMLElement ? start : null
  while (node && node !== container) {
    const style = getComputedStyle(node)
    if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1) {
      if (dy < 0 ? node.scrollTop > 0 : node.scrollTop < node.scrollHeight - node.clientHeight - 1) return true
    }
    node = node.parentElement
  }
  return false
}

function startGlide(el: HTMLElement, s: ScrollState): void {
  if (s.gliding) return
  s.gliding = true
  s.lastFrame = performance.now()
  const step = (now: number): void => {
    if (!s.gliding) return
    const dt = Math.min(0.05, (now - s.lastFrame) / 1000)
    s.lastFrame = now
    const remaining = s.target - el.scrollTop
    if (Math.abs(remaining) < 0.4) {
      el.scrollTop = s.target
      s.lastWritten = el.scrollTop
      s.gliding = false
      return
    }
    el.scrollTop += remaining * (1 - Math.exp(-GLIDE_RATE * dt))
    s.lastWritten = el.scrollTop
    requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

function startSpring(el: HTMLElement, s: ScrollState): void {
  if (s.springing) return
  s.springing = true
  s.lastFrame = performance.now()
  const step = (now: number): void => {
    const dt = Math.min(0.04, (now - s.lastFrame) / 1000)
    s.lastFrame = now
    const accel = -SPRING_STIFFNESS * s.stretch - SPRING_DAMPING * s.velocity
    s.velocity += accel * dt
    s.stretch += s.velocity * dt
    if (Math.abs(s.stretch) < 0.15 && Math.abs(s.velocity) < 1) {
      s.stretch = 0
      s.velocity = 0
      s.springing = false
      applyStretch(el, 0)
      return
    }
    applyStretch(el, s.stretch)
    requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

function onWheel(e: WheelEvent): void {
  if (e.ctrlKey || e.defaultPrevented || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
  if (!(e.target instanceof Element)) return
  const container = e.target.closest<HTMLElement>(CONTAINER_SELECTOR)
  if (!container || container.scrollHeight <= container.clientHeight) return
  const dy = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaMode === 2 ? e.deltaY * container.clientHeight : e.deltaY
  if (dy === 0 || nestedScrollerHandles(e.target, container, dy)) return

  const s = stateFor(container)
  const now = performance.now()
  if (now - s.lastWheelAt > GESTURE_GAP_MS) {
    // A notched mouse wheel sends large whole-number steps from the first event; a trackpad
    // starts with small fractional ones.
    s.mouseGesture = e.deltaMode !== 0 || (Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 40)
  }
  s.lastWheelAt = now

  const max = maxScroll(container)
  const atTop = container.scrollTop <= 0.5
  const atBottom = container.scrollTop >= max - 0.5

  // Already stretched, so the first thing a wheel does is un-stretch (below), before any real scrolling.
  const pushingOut = (atTop && dy < 0) || (atBottom && dy > 0)
  if (pushingOut) {
    e.preventDefault()
    s.gliding = false
    s.target = container.scrollTop
    const room = 1 - Math.min(1, Math.abs(s.stretch) / MAX_STRETCH)
    s.stretch += -dy * 0.9 * room
    s.stretch = Math.max(-MAX_STRETCH, Math.min(MAX_STRETCH, s.stretch))
    applyStretch(container, s.stretch)
    startSpring(container, s)
    return
  }
  if (s.stretch !== 0) {
    // Scrolling back the other way while stretched: unwind first, and swallow the event.
    e.preventDefault()
    const before = s.stretch
    s.stretch -= dy * 0.5
    if (Math.sign(before) !== Math.sign(s.stretch)) s.stretch = 0
    applyStretch(container, s.stretch)
    startSpring(container, s)
    return
  }

  if (s.mouseGesture) {
    e.preventDefault()
    const base = s.gliding ? s.target : container.scrollTop
    s.target = Math.max(0, Math.min(max, base + dy))
    startGlide(container, s)
  }
}

export function installSmoothScroll(): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  document.addEventListener('wheel', onWheel, { passive: false })
}
