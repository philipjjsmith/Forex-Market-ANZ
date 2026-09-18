import { Link } from "wouter";
import type { ReactNode } from "react";

/**
 * The shell for everything a logged-out visitor can reach.
 *
 * Before this there was no shared chrome at all: each page re-implemented its own,
 * only Analytics had a <header>, and the 404 had no way out of itself. Public pages
 * now share one nav and one footer.
 *
 * Scoped to PUBLIC routes on purpose. Dashboard, Analytics and Admin already carry
 * their own headers and cannot be rendered here to check the result, so bolting a
 * second nav onto them sight-unseen would be guesswork. They get this shell in
 * Phase 5, when those pages are restyled with someone looking at them.
 */

function Wordmark() {
  return (
    <Link
      href="/"
      className="flex items-center gap-2.5 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
    >
      <span
        aria-hidden="true"
        className="grid h-7 w-7 place-items-center rounded-[7px] bg-primary font-mono text-[15px] font-semibold text-primary-foreground"
      >
        A
      </span>
      <span className="text-[17px] font-semibold tracking-[-0.02em] text-foreground">
        ArgosFX
      </span>
    </Link>
  );
}

const navLink =
  "text-sm text-muted-foreground hover:text-foreground transition-colors rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary";

export function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="border-b border-border">
        <nav
          aria-label="Main"
          className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-4"
        >
          <Wordmark />
          <div className="ml-auto flex items-center gap-6">
            <Link href="/evidence" className={navLink}>
              Record
            </Link>
            <Link href="/method" className={navLink}>
              Method
            </Link>
            <Link href="/learn" className={navLink}>
              Learn
            </Link>
            <Link
              href="/login"
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              Sign in
            </Link>
          </div>
        </nav>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-6xl px-6 py-10">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <Wordmark />
            <div className="ml-auto flex flex-wrap items-center gap-x-6 gap-y-2">
              <Link href="/evidence" className={navLink}>
                Record
              </Link>
              <Link href="/method" className={navLink}>
                Method
              </Link>
              <Link href="/learn" className={navLink}>
                Learn
              </Link>
              <Link href="/risk" className={navLink}>
                Risk
              </Link>
              <Link href="/terms" className={navLink}>
                Terms
              </Link>
              <Link href="/privacy" className={navLink}>
                Privacy
              </Link>
            </div>
          </div>

          {/*
            The demo label travels with the product, not with a single page. NFA
            Interpretive Notice 9025 names the abuse of implying a simulated record is
            live, and nothing in this system has ever traded real money. It takes
            --muted-foreground rather than the tertiary step so it clears AA; see the
            Phase 2 note on where --subtle-foreground may and may not be used.
          */}
          <p className="mt-8 max-w-[66ch] text-sm leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">
              Demo account — simulated.
            </span>{" "}
            No real money is traded. Simulated results do not represent actual trading
            and are prepared with the benefit of hindsight. General information
            published identically to all subscribers, not tailored to you. Not
            investment advice.
          </p>

          <p className="mt-4 text-xs text-muted-foreground">
            © {new Date().getFullYear()} ArgosFX
          </p>
        </div>
      </footer>
    </div>
  );
}
