import { motion, useInView, useReducedMotion } from "motion/react"
import { useRef } from "react"

const hidden = { scale: 0.8, opacity: 0, y: 15 }
const shown = { scale: 1, opacity: 1, y: 0 }

/**
 * A list item that springs in as it scrolls into view and back out as it leaves,
 * ported from React Bits' AnimatedList (https://reactbits.dev). Falls back to a
 * plain <li> when the reader has asked for reduced motion.
 */
export function AnimatedItem({
  children,
  className,
  delay = 0.05,
}: {
  children: React.ReactNode
  className?: string
  delay?: number
}) {
  const ref = useRef<HTMLLIElement>(null)
  const inView = useInView(ref, { amount: 0.5 })
  const reduce = useReducedMotion()

  if (reduce) return <li className={className}>{children}</li>
  return (
    <motion.li
      ref={ref}
      initial={hidden}
      animate={inView ? shown : hidden}
      transition={{ type: "spring", stiffness: 300, damping: 20, delay }}
      className={className}
    >
      {children}
    </motion.li>
  )
}
