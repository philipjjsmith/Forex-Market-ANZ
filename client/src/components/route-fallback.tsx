/**
 * What fills the gap while a route chunk downloads.
 *
 * Two deliberate choices. It paints the token background, so a slow chunk never
 * flashes a different ground than the page that follows it. And it stays invisible
 * for the first 250ms: on a warm cache a route chunk arrives in single-digit
 * milliseconds, and a spinner that appears and vanishes inside one frame reads as a
 * glitch rather than as progress. Below that threshold the user just sees the next
 * page.
 *
 * The delay is CSS-only (`.route-spinner` in index.css) — no timer, no state, nothing
 * to clean up — and it is inside `motion-safe`, so reduced-motion users get a static
 * dot instead of a spin.
 */
export function RouteFallback() {
  return (
    <div
      className="min-h-screen flex items-center justify-center bg-background"
      role="status"
      aria-live="polite"
    >
      <span className="sr-only">Loading</span>
      <div aria-hidden="true" className="route-spinner" />
    </div>
  );
}
