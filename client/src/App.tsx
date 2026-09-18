import { lazy, Suspense } from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { RouteFallback } from "@/components/route-fallback";

/**
 * Every route is split.
 *
 * Before this, the whole application shipped as ONE 1.27 MB chunk (362 KB over the
 * wire) to render a login form. Admin.tsx is 2,443 lines and is the only importer
 * of recharts, so a logged-out stranger downloaded the entire admin console and a
 * charting library to type an email address.
 *
 * Login and AuthCallback are deliberately NOT lazy. `/login` is the entry point for
 * every unauthenticated visitor and `/auth/callback` is a redirect target that must
 * paint immediately; putting either behind a second network round trip would trade
 * the win away exactly where it matters most. Both are small.
 */
const Landing = lazy(() => import("@/pages/Landing"));
const Method = lazy(() => import("@/pages/Method"));
const Evidence = lazy(() => import("@/pages/Evidence"));
const Terms = lazy(() => import("@/pages/Legal").then((m) => ({ default: m.Terms })));
const Privacy = lazy(() => import("@/pages/Legal").then((m) => ({ default: m.Privacy })));
const Risk = lazy(() => import("@/pages/Legal").then((m) => ({ default: m.Risk })));
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const Analytics = lazy(() => import("@/pages/Analytics"));
const Learn = lazy(() => import("@/pages/Learn"));
const Admin = lazy(() => import("@/pages/Admin"));
const NotFound = lazy(() => import("@/pages/not-found"));

import Login from "@/pages/Login";
import AuthCallback from "@/pages/AuthCallback";

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      {/* Where Google sign-in returns. Must sit above the catch-all or it renders the 404. */}
      <Route path="/auth/callback" component={AuthCallback} />
      {/* `/` is the PUBLIC front door. It used to be the auth-walled Dashboard, which
          is why this product had no marketing surface at all. The application now
          lives at /app. */}
      <Route path="/" component={Landing} />
      <Route path="/method" component={Method} />
      <Route path="/evidence" component={Evidence} />
      <Route path="/terms" component={Terms} />
      <Route path="/privacy" component={Privacy} />
      <Route path="/risk" component={Risk} />
      <Route path="/app" component={Dashboard} />
      <Route path="/analytics" component={Analytics} />
      <Route path="/learn" component={Learn} />
      <Route path="/admin" component={Admin} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <Suspense fallback={<RouteFallback />}>
            <Router />
          </Suspense>
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
