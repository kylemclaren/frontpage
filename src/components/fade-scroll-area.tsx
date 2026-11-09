import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area"
import { cn } from "cn"

/**
 * A scroll area whose top and bottom edges fade out, but only on the side where
 * there is more to see. Base UI sets --scroll-area-overflow-y-start/-end on the
 * viewport (how many px are hidden above/below); the mask in index.css
 * (.scroll-fade-y) grows each fade up to --scroll-area-fade-size from those.
 * The root is a flex column so the viewport fills it even when the parent's
 * height comes from max-height (where height: 100% would not resolve).
 */
export function FadeScrollArea({
  className,
  viewportClassName,
  children,
  ...props
}: ScrollAreaPrimitive.Root.Props & { viewportClassName?: string }) {
  return (
    <ScrollAreaPrimitive.Root className={cn("relative flex min-h-0 flex-col", className)} {...props}>
      <ScrollAreaPrimitive.Viewport
        className={cn(
          "scroll-fade-y min-h-0 flex-1 overscroll-contain rounded-[inherit] outline-none [--scroll-area-fade-size:28px]",
          viewportClassName,
        )}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollAreaPrimitive.Scrollbar
        orientation="vertical"
        className="m-1 flex w-1.5 touch-none justify-center rounded-full opacity-0 transition-opacity select-none data-hovering:opacity-100 data-scrolling:opacity-100 data-scrolling:duration-0"
      >
        <ScrollAreaPrimitive.Thumb className="w-full rounded-full bg-foreground/20" />
      </ScrollAreaPrimitive.Scrollbar>
    </ScrollAreaPrimitive.Root>
  )
}
