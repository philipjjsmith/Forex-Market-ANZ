import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { getApiBaseUrl, setToken } from '@/lib/auth';

/**
 * Where Google sign-in lands.
 *
 * The server never redirects here with a token in the URL — a URL ends up in browser history, in
 * the Referer header of the next request this page makes, and in every proxy log on the way. It
 * sends a single-use code with a 60-second life instead, and this page trades that code for the
 * real JWT over a POST, which appears in none of those places.
 *
 * The exchange is deliberately allowed to run only once. React 18's StrictMode double-invokes
 * effects in development, and the server deletes a code the moment it is read — so without the
 * guard the second call would consume nothing, report "already used", and show a failure on a
 * sign-in that actually succeeded.
 */
export default function AuthCallback() {
  const [, navigate] = useLocation();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');

      if (!code) {
        // Reachable if someone opens /auth/callback directly, or Google bounced them back with
        // an error the server turned into a redirect.
        if (!cancelled) setError('No sign-in code was returned. Please try again.');
        return;
      }

      try {
        const res = await fetch(`${getApiBaseUrl()}/api/auth/google/exchange`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ code }),
        });
        const data = await res.json();

        if (!res.ok || !data.success || !data.token) {
          if (!cancelled) setError(data.error || 'Sign-in could not be completed.');
          return;
        }

        setToken(data.token);

        // Clear the code from the address bar before leaving, so a single-use code that is already
        // spent does not sit in history looking meaningful.
        window.history.replaceState({}, '', '/auth/callback');

        // Admins land on the dashboard they were almost certainly trying to reach; everyone else
        // goes to /app, because /admin would only 403 at them. (`/` is the public
        // landing page since Phase 4, so sending them there would look like a failed login.)
        navigate(data.user?.role === 'admin' ? '/admin' : '/app');
      } catch {
        if (!cancelled) setError('Network error while completing sign-in.');
      }
    };

    run();
    return () => { cancelled = true; };
    // Intentionally empty: this must run exactly once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-card text-foreground p-6">
      <div className="max-w-md w-full bg-muted border border-border rounded-xl p-7 text-center">
        {error ? (
          <>
            <h1 className="text-lg font-semibold text-white mb-3">Sign-in didn't complete</h1>
            <p className="text-foreground-secondary mb-5">{error}</p>
            <a
              href="/login"
              className="inline-block bg-orange-500 hover:bg-orange-600 text-white font-semibold px-5 py-2.5 rounded-lg no-underline"
            >
              Back to sign in
            </a>
          </>
        ) : (
          <>
            <h1 className="text-lg font-semibold text-white mb-3">Finishing sign-in…</h1>
            <p className="text-muted-foreground">One moment.</p>
          </>
        )}
      </div>
    </div>
  );
}
