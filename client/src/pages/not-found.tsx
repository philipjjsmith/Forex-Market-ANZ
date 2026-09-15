import { Link } from "wouter";
import { Compass } from "lucide-react";
import { PublicLayout } from "@/components/public-layout";

/**
 * 404.
 *
 * What this replaced: a light-grey card reading "Did you forget to add the page to the router?"
 * — a message written for whoever was building the app, shipped to whoever was using it, on a
 * white ground that contradicted every other page. `body` paints the dark gradient globally, so
 * the fix is to stop overriding it with `bg-gray-50` and to write copy for a visitor.
 *
 * Deliberately hardcoded slate/amber, matching Login.tsx. The semantic token layer is not yet
 * trustworthy here (`text-foreground` resolves to a near-black value against this dark ground),
 * and repointing it is Phase 1 — not this change.
 */
export default function NotFound() {
  return (
    <PublicLayout>
      <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="w-full max-w-md text-center">
        <div className="inline-flex p-3 mb-6 rounded-lg bg-primary/15 border border-primary/30">
          <Compass className="w-8 h-8 text-primary" aria-hidden="true" />
        </div>

        <p className="font-mono text-xs tracking-[0.2em] text-primary/80 mb-3">
          ERROR 404
        </p>

        <h1 className="text-3xl font-bold text-white mb-3">
          This page doesn't exist
        </h1>

        <p className="text-muted-foreground mb-8 leading-relaxed">
          The link may be out of date, or the address may have a typo in it.
          Everything live is reachable from the dashboard.
        </p>

        <div className="flex flex-wrap gap-3 justify-center">
          <Link
            href="/"
            className="px-5 py-2.5 rounded-md bg-primary hover:bg-primary/90 text-primary-foreground font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            Go to the dashboard
          </Link>
          <Link
            href="/learn"
            className="px-5 py-2.5 rounded-md border border-border hover:border-input text-foreground font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            Learn the basics
          </Link>
        </div>

        </div>
      </div>
    </PublicLayout>
  );
}
