import { useCallback, ReactNode, useEffect, useState } from "react";
import { AuthContext, SessionUser } from "./AuthContext";
import {
    apiFetch,
    clearSessionFlag,
    hasSessionFlag,
    setUnauthorizedHandler,
} from "../../lib/apiFetch";

interface AuthProviderProps {
    children: ReactNode;
}

/** setTimeout stores its delay as a signed 32-bit integer; longer delays fire at once. */
const MAX_TIMER_MS = 2 ** 31 - 1;

/**
 * Holds whether someone is logged in -- never the credential itself.
 *
 * The JWT sits in an httpOnly cookie that the browser attaches on its own, including on
 * the dashboard WebSocket handshake. What is left here is a flag, read from a second
 * cookie that carries no secret, and the identity /api/v1/me reports for the session.
 *
 * The flag can be stale: the token may be rejected while the flag is still set. That
 * corrects itself on the first API call, because apiFetch turns a 401 into logout().
 */
export const AuthProvider = ({ children }: AuthProviderProps) => {
    const [isAuthenticated, setIsAuthenticated] = useState<boolean>(hasSessionFlag);
    const [user, setUser] = useState<SessionUser | null>(null);
    const [expiresAt, setExpiresAt] = useState<number | null>(null);

    // Memoised: Login.tsx and the effects below keep them in dependency arrays.
    const login = useCallback(() => {
        setIsAuthenticated(true);
    }, []);

    const logout = useCallback(() => {
        setIsAuthenticated(false);
        setUser(null);
        setExpiresAt(null);
        clearSessionFlag();
        // The session cookie is httpOnly, so only the server can remove it. Not awaited:
        // the UI returns to the login form either way, and plain fetch because a 401 from
        // apiFetch would call straight back into this function.
        void fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).catch(
            () => undefined,
        );
    }, []);

    // apiFetch is a plain module and cannot read this context, so it gets handed the one
    // thing it needs: what to do when the server says the session is over. Clearing the
    // flag re-renders the router into the login route.
    useEffect(() => {
        setUnauthorizedHandler(logout);
        return () => setUnauthorizedHandler(null);
    }, [logout]);

    // Asks the server who the session belongs to. Also where a stale flag is caught: a
    // cookie left over from an expired token answers 401, which apiFetch turns into the
    // logout above -- so the app lands on the login form instead of a dashboard whose
    // every request is about to fail.
    useEffect(() => {
        if (!isAuthenticated) return;
        let cancelled = false;
        const load = async () => {
            try {
                const res = await apiFetch("/api/v1/me");
                if (!res.ok || cancelled) return;
                const data: { id: number; username: string; expiresAt: string | null } =
                    await res.json();
                if (cancelled) return;
                setUser({ id: data.id, username: data.username });
                setExpiresAt(data.expiresAt ? Date.parse(data.expiresAt) : null);
            } catch {
                // A 401 has already logged out through apiFetch; anything else only leaves
                // the header without a name, which is not worth a dialog.
            }
        };
        load();
        return () => {
            cancelled = true;
        };
    }, [isAuthenticated]);

    // A 401 only arrives with the next request. An open dashboard fed by the WebSocket may
    // not send one for a long time, so the expiry is also acted on when it comes.
    useEffect(() => {
        if (expiresAt === null) return;
        const delay = expiresAt - Date.now();
        if (delay > MAX_TIMER_MS) return;
        const timer = setTimeout(logout, Math.max(delay, 0));
        return () => clearTimeout(timer);
    }, [expiresAt, logout]);

    return (
        <AuthContext.Provider value={{ isAuthenticated, user, login, logout }}>
            {children}
        </AuthContext.Provider>
    );
};
