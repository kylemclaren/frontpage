import { useSyncExternalStore } from "react"

/** "dark" or "light" as actually applied: follows the toggle and, in system mode, the OS. */
export function useResolvedTheme(): "dark" | "light" {
  return useSyncExternalStore(
    (onChange) => {
      const observer = new MutationObserver(onChange)
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
      return () => observer.disconnect()
    },
    () => (document.documentElement.classList.contains("dark") ? "dark" : "light"),
    () => "dark",
  )
}
