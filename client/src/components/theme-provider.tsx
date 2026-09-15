import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ReactNode } from "react";

/**
 * The provider that was missing.
 *
 * `next-themes` has been a dependency of this project for months and was imported
 * nowhere. Nothing ever set `.dark` on any element, so the entire dark palette in
 * index.css and all 40 `dark:` utilities across the components were unreachable —
 * the site only looked dark because `body` carried a hardcoded gradient.
 *
 * Despite the name, `next-themes` is framework-agnostic; it manipulates the class
 * on <html> and needs nothing from Next.
 *
 * Deliberate choices:
 *
 * - `defaultTheme="dark"` and `enableSystem={false}`. Dark is the PRODUCT default,
 *   not a user preference we are guessing at — a trading interface is read on dark.
 *   Light is built as a genuine inversion of the same hues and is ready, but it is
 *   not yet user-reachable: the switch belongs in the shared nav, which is Phase 3.
 *   Turning `enableSystem` on before that switch exists would hand half of visitors
 *   a theme they cannot leave.
 *
 * - `class="dark"` is ALSO hardcoded on <html> in client/index.html. That is not
 *   redundancy for its own sake: it makes the very first paint dark, before any
 *   JavaScript runs, so there is no white flash on a cold load — which matters on
 *   a free-tier instance that spins down.
 *
 * - `disableTransitionOnChange` stops every colour transition on the page from
 *   firing at once when the theme flips.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem={false}
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
