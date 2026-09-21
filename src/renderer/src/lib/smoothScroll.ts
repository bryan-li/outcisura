/** Smooth mouse-wheel scrolling for the main content pane and the sidebar list: a notched wheel
 *  sends big discrete steps, so each one moves a target and the real scroll position eases toward it
 *  (like YouTube or Chrome's own smooth scrolling). Trackpad scrolling is left to the browser, which
 *  already has momentum.
 *
 *  Skipped for reduced-motion users, pinch-zoom, horizontal gestures, and whenever the pointer is over
 *  a nested scroller that can still move in that direction. */

const CONTAINER_SELECTOR = 'main, .sidebar-scroll'
/** Half-life-ish easing: the fraction of the remaining distance covered per second is 1 - e^(-k). */
const GLIDE_RATE = 14
const GESTURE_GAP_MS = 90

interface ScrollState {
  /** Where the glide is heading (mouse mode). */
  target: number
  /** The scrollTop we last wrote, so an outside change (scrollbar drag, scrollTo, page change) can be told apart. */
  lastWritten: number
  gliding: boolean
  lastWheelAt: number
  /** Decided at the start of each wheel gesture: true for a notched mouse wheel. */
  mouseGesture: boolean
  lastFrame: number
}

const states = new WeakMap<HTMLElement, ScrollState>()

function stateFor(el: HTMLElement): ScrollState {
  let s = states.get(el)
  if (!s) {
    s = { target: el.scrollTop, lastWritten: el.scrollTop, gliding: false, lastWheelAt: 0, mouseGesture: false, lastFrame: 0 }
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
