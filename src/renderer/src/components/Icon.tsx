import type { CSSProperties, ReactNode } from 'react'

/** The app's one icon set: minimal outline glyphs on a 24px grid, drawn with `currentColor` so they
 *  take whatever text colour surrounds them (and so work unchanged in light and dark themes). Replaces
 *  the emoji and text glyphs (▶ ✕ ＋ …) the UI used to lean on — those render differently per OS and
 *  can't be recoloured or sized with the text around them.
 *
 *  Add an icon by adding one entry below; keep to ~1.75px strokes, round caps/joins, and the 24x24
 *  grid so everything stays visually even. `filled` is for the few solid shapes (play/pause/stop). */
const ICONS = {
  search: <><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></>,
  home: <><path d="M4 11.5 12 4l8 7.5" /><path d="M6 10v9.5h12V10" /><path d="M10 19.5v-5h4v5" /></>,
  review: <><path d="M4 12a8 8 0 0 1 13.5-5.8L20 8.5" /><path d="M20 4v4.5h-4.5" /><path d="M20 12a8 8 0 0 1-13.5 5.8L4 15.5" /><path d="M4 20v-4.5h4.5" /></>,
  layers: <><path d="M12 4 3 9l9 5 9-5-9-5z" /><path d="M3 14l9 5 9-5" /></>,
  graph: <><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="18" cy="18" r="2.5" /><path d="M8.2 10.8l7.6-3.6M8.2 13.2l7.6 3.6" /></>,
  warning: <><path d="M12 4 2.8 19.5h18.4L12 4z" /><path d="M12 10v4.5" /><path d="M12 17.3v.1" /></>,
  broadcast: <><circle cx="12" cy="12" r="1.8" /><path d="M8.3 8.3a5.2 5.2 0 0 0 0 7.4M15.7 8.3a5.2 5.2 0 0 1 0 7.4" /><path d="M5.2 5.2a9.6 9.6 0 0 0 0 13.6M18.8 5.2a9.6 9.6 0 0 1 0 13.6" /></>,
  join: <><path d="M14 4.5h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-5" /><path d="M4 12h11" /><path d="M11.5 8l4 4-4 4" /></>,
  folder: <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4.2l2 2.3h8.8A1.5 1.5 0 0 1 21 9.8v7.7a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5v-10z" />,
  'folder-plus': <><path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4.2l2 2.3h8.8A1.5 1.5 0 0 1 21 9.8v7.7a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5v-10z" /><path d="M12 11.5v5M9.5 14h5" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  'chevron-right': <path d="M9 6l6 6-6 6" />,
  'chevron-down': <path d="M6 9l6 6 6-6" />,
  'chevrons-left': <path d="M12.5 6l-6 6 6 6M18.5 6l-6 6 6 6" />,
  'chevrons-right': <path d="M11.5 6l6 6-6 6M5.5 6l6 6-6 6" />,
  'arrow-left': <path d="M19 12H5M11 6l-6 6 6 6" />,
  'arrow-right': <path d="M5 12h14M13 6l6 6-6 6" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  x: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  sliders: <><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></>,
  shield: <><path d="M12 3.5 5 6v5.5c0 4.2 2.8 7.2 7 9 4.2-1.8 7-4.8 7-9V6l-7-2.5z" /><path d="M9.3 12l2 2 3.6-4" /></>,
  file: <><path d="M6.5 3.5h7l4 4v13h-11z" /><path d="M13.5 3.5v4h4" /></>,
  'file-text': <><path d="M6.5 3.5h7l4 4v13h-11z" /><path d="M13.5 3.5v4h4" /><path d="M9.5 13h5M9.5 16.5h5" /></>,
  presentation: <><rect x="3.5" y="4.5" width="17" height="11" rx="1" /><path d="M12 15.5v4M8.5 19.5h7" /></>,
  video: <><rect x="3.5" y="5.5" width="17" height="13" rx="1.5" /><path d="M10 9.5v5l4.5-2.5-4.5-2.5z" /></>,
  grip: <path d="M9 6.5h.01M15 6.5h.01M9 12h.01M15 12h.01M9 17.5h.01M15 17.5h.01" strokeWidth="2.6" />,
  trash: <><path d="M4.5 7h15M9.5 7V5h5v2" /><path d="M6.5 7l.8 12h9.4l.8-12" /><path d="M10 11v5M14 11v5" /></>,
  link: <><path d="M10 14a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1 1" /><path d="M14 10a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1-1" /></>,
  image: <><rect x="3.5" y="5" width="17" height="14" rx="1.5" /><circle cx="9" cy="10" r="1.5" /><path d="M4 17l5-4.5 4 3 3-2.5 4 3.5" /></>,
  camera: <><path d="M4 8h3l1.5-2.5h7L17 8h3v11H4z" /><circle cx="12" cy="13" r="3.2" /></>,
  sparkles: <><path d="M10.5 5l1.8 4.7 4.7 1.8-4.7 1.8-1.8 4.7-1.8-4.7L4 11.5l4.7-1.8L10.5 5z" /><path d="M18 3.5v3M16.5 5h3" /><path d="M18.5 15.5v3.5M16.8 17.2h3.4" /></>,
  flame: <path d="M12 3c1 3.5 5.5 5.6 5.5 10.5a5.5 5.5 0 0 1-11 0c0-2 1-3.5 2-4.5.3 1.4 1 2 1.7 2.2C10 8.2 10.5 5.5 12 3z" />,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  'check-circle': <><circle cx="12" cy="12" r="8.5" /><path d="M8.5 12.2l2.5 2.5 4.5-5" /></>,
  'x-circle': <><circle cx="12" cy="12" r="8.5" /><path d="M9 9l6 6M15 9l-6 6" /></>,
  mic: <><rect x="9.5" y="3.5" width="5" height="10" rx="2.5" /><path d="M6 11.5a6 6 0 0 0 12 0M12 17.5v3M9 20.5h6" /></>,
  users: <><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19c0-3.3 2.5-5.5 5.5-5.5s5.5 2.2 5.5 5.5" /><path d="M16 5.3a3.2 3.2 0 0 1 0 6.1" /><path d="M14.8 13.5c2.8.2 5.2 2.4 5.2 5.5" /></>,
  'user-plus': <><circle cx="9" cy="9" r="3.5" /><path d="M2.5 19.5c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" /><path d="M18.5 8v5M16 10.5h5" /></>,
  flag: <path d="M5.5 20.5V4M5.5 5h11l-2 3.5 2 3.5h-11" />,
  globe: <><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.5 2.5 3.5 5.5 3.5 8.5s-1 6-3.5 8.5c-2.5-2.5-3.5-5.5-3.5-8.5s1-6 3.5-8.5z" /></>,
  lock: <><rect x="5.5" y="10.5" width="13" height="9.5" rx="1.5" /><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" /></>,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.8" /></>,
  send: <><path d="M20.5 3.5 3.5 10.5l6.5 2.5 2.5 6.5 8-16z" /><path d="M10 13l10.5-9.5" /></>,
  upload: <path d="M12 16V5M7.5 9.5 12 5l4.5 4.5M4.5 19.5h15" />,
  play: <path d="M8 5.5v13l10-6.5-10-6.5z" />,
  pause: <><rect x="7" y="5" width="3.5" height="14" rx="1" /><rect x="13.5" y="5" width="3.5" height="14" rx="1" /></>,
  stop: <rect x="6" y="6" width="12" height="12" rx="1.5" />,
  'skip-forward': <><path d="M6 5.5v13l9-6.5-9-6.5z" /><path d="M18.5 5.5v13" /></>,
  rewind: <><path d="M11 6.5v11L3.5 12 11 6.5z" /><path d="M20.5 6.5v11L13 12l7.5-5.5z" /></>,
  'fast-forward': <><path d="M13 6.5v11l7.5-5.5L13 6.5z" /><path d="M3.5 6.5v11L11 12 3.5 6.5z" /></>,
  'volume-x': <><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" /><path d="M16 9.5l5 5M21 9.5l-5 5" /></>,
  'volume-1': <><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" /><path d="M15.5 9a4 4 0 0 1 0 6" /></>,
  'volume-2': <><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" /><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11" /></>,
  scissors: <><circle cx="6.5" cy="6.5" r="2.5" /><circle cx="6.5" cy="17.5" r="2.5" /><path d="M8.7 7.7 20 18.5M8.7 16.3 20 5.5" /></>,
  pin: <><path d="M12 21s6.5-5.7 6.5-11a6.5 6.5 0 0 0-13 0c0 5.3 6.5 11 6.5 11z" /><circle cx="12" cy="10" r="2.3" /></>,
  bookmark: <path d="M7 4.5h10v15l-5-3.5-5 3.5v-15z" />,
  undo: <path d="M8.5 5.5l-4 4 4 4M4.5 9.5H14a5 5 0 0 1 0 10h-3" />,
  refresh: <><path d="M19.5 12a7.5 7.5 0 1 1-2.3-5.4" /><path d="M19.5 4.5v4.5H15" /></>,
  inbox: <><path d="M3.5 13.5h5l1 2.5h5l1-2.5h5" /><path d="M5.5 13.5 7 5.5h10l1.5 8v5h-13v-5z" /></>,
  coffee: <><path d="M5 9.5h11v5a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4v-5z" /><path d="M16 11h1.5a2.5 2.5 0 0 1 0 5H16M8.5 3.5v3M12 3.5v3" /></>,
  timer: <><circle cx="12" cy="13.5" r="7" /><path d="M12 10v3.5l2 1.5M9.5 3.5h5" /></>
} satisfies Record<string, ReactNode>

export type IconName = keyof typeof ICONS

const FILLED: ReadonlySet<IconName> = new Set(['play', 'pause', 'stop'])

interface IconProps {
  name: IconName
  /** CSS size; defaults to 1.15em so the icon scales with the text it sits next to. */
  size?: number | string
  /** Icon-only usage (a button that's nothing but the icon): drops the gap normally left for a label. */
  bare?: boolean
  style?: CSSProperties
}

export function Icon({ name, size = '1.15em', bare = false, style }: IconProps): JSX.Element {
  const filled = FILLED.has(name)
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={filled ? 1.5 : 1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: 'inline-block', verticalAlign: '-0.22em', flexShrink: 0, marginRight: bare ? 0 : '0.45em', ...style }}
    >
      {ICONS[name]}
    </svg>
  )
}

/** The icon for a Library document's file type — used anywhere a document is listed. */
export function DocTypeIcon({ type, size, bare }: { type: 'pdf' | 'pptx' | 'video'; size?: number | string; bare?: boolean }): JSX.Element {
  return <Icon name={type === 'pdf' ? 'file-text' : type === 'pptx' ? 'presentation' : 'video'} size={size} bare={bare} />
}
