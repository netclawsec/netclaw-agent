import { useEffect, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";

type AuthState = "checking" | "anonymous" | "authenticated";

/**
 * Wrap the main app shell. Probes /api/employee/whoami on mount; if the user
 * isn't logged in, force-redirects to /login. Public/auth-free pages
 * (`/login`) bypass this entirely. Re-checks every time the route changes
 * so logging out (or session expiry) kicks the user back to /login on the
 * next navigation.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [state, setState] = useState<AuthState>("checking");

  useEffect(() => {
    // /login is the auth surface itself — never gate it.
    if (location.pathname === "/login") {
      setState("anonymous");
      return;
    }

    let cancelled = false;
    setState("checking");
    fetch("/api/employee/whoami")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data?.logged_in) {
          setState("authenticated");
        } else {
          setState("anonymous");
          navigate("/login", { replace: true });
        }
      })
      .catch(() => {
        if (cancelled) return;
        setState("anonymous");
        navigate("/login", { replace: true });
      });
    return () => {
      cancelled = true;
    };
  }, [location.pathname, navigate]);

  if (location.pathname === "/login") {
    return <>{children}</>;
  }

  if (state === "checking") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground">
        <div className="flex items-center gap-2.5 text-sm">
          <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          正在检查登录状态…
        </div>
      </div>
    );
  }

  if (state === "anonymous") {
    // navigate() already kicked to /login — render nothing while it transitions.
    return null;
  }

  return <>{children}</>;
}
