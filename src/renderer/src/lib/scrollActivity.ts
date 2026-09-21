/** Marks whichever element is scrolling with `data-scrolling` for a moment after each scroll event, so
 *  CSS can reveal its (otherwise invisible) scrollbar thumb only while you're actually scrolling — see
 *  the `[data-scrolling]` rule in styles.css. Revealing on plain hover was far too eager: the main panel
 *  covers most of the window, so nearly everywhere the pointer went showed a scrollbar.
 *
 *  One capture-phase listener on the document (scroll events don't bubble, but they do capture); a
 *  data attribute rather than a class so React re-renders can't strip it. */
const HIDE_AFTER_MS = 900
const timers = new WeakMap<Element, number>()

export function installScrollActivity(): void {
  document.addEventListener(
    'scroll',
    (event) => {
      const el = event.target
      if (!(el instanceof HTMLElement)) return
      el.dataset.scrolling = '1'
      window.clearTimeout(timers.get(el))
      timers.set(
        el,
        window.setTimeout(() => {
          delete el.dataset.scrolling
        }, HIDE_AFTER_MS)
      )
    },
    true
  )
}
