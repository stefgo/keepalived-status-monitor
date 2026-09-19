import { useState, useEffect } from "react";
import { useAuth } from "../features/auth/AuthContext";
import { getErrorMessage } from "../utils";
import { useTheme } from "../features/app/context/ThemeContext";
import { LoginPage } from "@stefgo/react-ui-components";

export default function Login() {
    const [error, setError] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [authType, setAuthType] = useState<"local" | "oidc" | null>(null);
    const { login } = useAuth();
    const { theme, toggleTheme } = useTheme();

    // The OIDC return used to land here as /login?token=<JWT>. The server now sets the
    // session cookie itself and redirects to "/", so there is nothing to read from the URL.

    useEffect(() => {
        fetch("/api/auth/config")
            .then(res => res.json())
            .then(data => setAuthType(data.type))
            .catch(() => setAuthType("local"));
    }, []);

    const handleLogin = async (username: string, password: string) => {
        setError("");
        setIsLoading(true);
        try {
            // Plain fetch, not apiFetch, and on purpose: a 401 from /api/login means a
            // wrong password, not an expired session. See the note in lib/apiFetch.ts.
            const res = await fetch("/api/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, password }),
                // What this response is worth is its Set-Cookie header.
                credentials: "same-origin",
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Login failed");
            // No token to pass on: the server has set the session cookies on this response.
            login();
        } catch (err: unknown) {
            setError(getErrorMessage(err));
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <LoginPage
            title="Keepalived"
            titleHighlight="Status"
            subtitle="Monitor"
            authType={authType}
            error={error}
            isLoading={isLoading}
            onLogin={handleLogin}
            onOidcLogin={() => { window.location.href = "/api/auth/login"; }}
            theme={theme}
            onToggleTheme={toggleTheme}
        />
    );
}
