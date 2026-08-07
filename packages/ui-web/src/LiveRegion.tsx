export interface LiveRegionProps {
  message: string;
  /** "polite" (default) waits for a pause; "assertive" interrupts immediately. */
  politeness?: "polite" | "assertive";
}

/**
 * Visually-hidden ARIA live region announcing meaningful diagram changes —
 * element added/deleted, connected, grouped/ungrouped, validation fixed
 * (packages/core/docs/accessibility.md#canvas-the-hard-20). Render once per app and
 * update `message` to announce; the host is responsible for briefly clearing
 * it first if the same message needs to be announced twice in a row.
 */
export function LiveRegion({
  message,
  politeness = "polite",
}: LiveRegionProps) {
  return (
    <div
      className="icad-visually-hidden"
      role="status"
      aria-live={politeness}
      aria-atomic="true"
    >
      {message}
    </div>
  );
}
