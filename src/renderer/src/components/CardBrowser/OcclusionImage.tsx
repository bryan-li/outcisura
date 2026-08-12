import type { BBox } from '../../../../shared/types'
import { useResolvedImage } from '../../hooks/useResolvedImage'

interface OcclusionImageProps {
  imagePath: string
  /** Fractional (0-1) boxes relative to the image's own natural width/height — empty means
   *  nothing to hide (a non-occlusion source, or a legacy occlusion card with no stored mask). */
  maskBBoxes: BBox[]
  /** true = answer state, boxes are not drawn (their contents are visible). */
  revealed: boolean
  maxWidth?: number
}

/** Renders an image with 0+ dark boxes positioned by percentage over it — deliberately percentage-
 *  based, not pixel-based, so it never needs to know the image's natural dimensions at render
 *  time (see card_sources.mask_* migration for why that mattered). */
export function OcclusionImage({ imagePath, maskBBoxes, revealed, maxWidth }: OcclusionImageProps): JSX.Element | null {
  const src = useResolvedImage(imagePath)
  if (!src) return null

  return (
    <div style={{ position: 'relative', display: 'inline-block', maxWidth: maxWidth ?? '100%', lineHeight: 0 }}>
      <img
        src={src}
        alt="Occlusion source"
        style={{ display: 'block', maxWidth: '100%', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}
      />
      {!revealed &&
        maskBBoxes.map((b, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: `${b.x * 100}%`,
              top: `${b.y * 100}%`,
              width: `${b.w * 100}%`,
              height: `${b.h * 100}%`,
              background: '#1a1a1a',
              borderRadius: 2
            }}
          />
        ))}
    </div>
  )
}
