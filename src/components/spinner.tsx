import { Arc } from "loading-dev"

/** Loading indicator from loading.dev; takes the surrounding text colour. */
export function Spinner({ size = 14, className }: { size?: number; className?: string }) {
  return <Arc size={size} className={className} />
}
