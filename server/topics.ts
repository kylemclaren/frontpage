export interface Interest {
  id: string
  label: string
  description: string
  /** A topic the reader wants filtered out rather than surfaced. */
  avoid?: boolean
}
