import React from "react";
import ReactDOM from "react-dom/client";
import App from "./features/app/App";
import "./index.css";

// A deploy replaces the hashed chunks, so a tab still running the previous build fails
// to load the next lazy route. Reload once to pick up the new index.html. The time stamp
// keeps a chunk that is missing from the new build as well from reloading in a loop.
const CHUNK_RELOAD_KEY = "chunk-reload-at";
window.addEventListener("vite:preloadError", (event) => {
    try {
        const last = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY)) || 0;
        if (Date.now() - last < 10_000) return;
        sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
    } catch {
        // Without storage there is no guard against a loop, so leave the error as it is.
        return;
    }
    event.preventDefault();
    window.location.reload();
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
);
