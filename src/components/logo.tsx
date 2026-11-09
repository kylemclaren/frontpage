import { useId } from "react"

/**
 * Frontpage mark: an orange tile holding a tiny feed. The top story has a score
 * ring beside it; the stories below fade away. The best of HN, bubbled up.
 * public/favicon.svg is the same drawing.
 */
export function Logo({ className }: { className?: string }) {
  const id = useId()
  const r = 7.5
  const c = 2 * Math.PI * r
  return (
    <svg viewBox="0 0 64 64" className={className} role="img" aria-label="Frontpage">
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff9147" />
          <stop offset="1" stopColor="#f04a00" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill={`url(#${id}-bg)`} />
      <circle cx="20" cy="22" r={r} fill="none" stroke="#fff" strokeOpacity=".32" strokeWidth="4" />
      <circle
        cx="20"
        cy="22"
        r={r}
        fill="none"
        stroke="#fff"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={`${c * 0.74} ${c}`}
        transform="rotate(-90 20 22)"
      />
      <rect x="33" y="18" width="19" height="8" rx="4" fill="#fff" />
      <rect x="12" y="36" width="40" height="5" rx="2.5" fill="#fff" fillOpacity=".55" />
      <rect x="12" y="46" width="27" height="5" rx="2.5" fill="#fff" fillOpacity=".3" />
    </svg>
  )
}
