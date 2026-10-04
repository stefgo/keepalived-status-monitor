#!/usr/bin/env node
// Takes the screenshots in docs/assets/screenshots from a running server.
//
// It expects the dev stack (compose.dev.yaml) with both agents registered and at least one
// failover in the activity history, see docs/development.md. Playwright is not a dependency
// of any workspace; install it anywhere and point PLAYWRIGHT_DIR at that directory:
//
//   npm install --prefix /tmp/kasm-pw playwright && npx --prefix /tmp/kasm-pw playwright install chromium
//   PLAYWRIGHT_DIR=/tmp/kasm-pw node scripts/screenshots/capture.mjs
//
// KASM_URL (default http://localhost:3010), KASM_USER and KASM_PASSWORD (default admin/admin)
// select the server and the account, KASM_AGENT_URL (default http://localhost:3011, node a)
// the agent whose status page is captured.

import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const baseUrl = process.env.KASM_URL ?? "http://localhost:3010";
const username = process.env.KASM_USER ?? "admin";
const password = process.env.KASM_PASSWORD ?? "admin";
const agentUrl = process.env.KASM_AGENT_URL ?? "http://localhost:3011";
const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../docs/assets/screenshots");

const loadPlaywright = async () => {
    if (process.env.PLAYWRIGHT_DIR) {
        const require = createRequire(path.join(path.resolve(process.env.PLAYWRIGHT_DIR), "package.json"));
        return require("playwright");
    }
    return import("playwright");
};

const { chromium } = await loadPlaywright();

const viewport = { width: 1440, height: 900 };
const browser = await chromium.launch();

// The interface writes dates the way the browser's locale does, in the browser's time zone.
// Both are pinned, so the pictures do not depend on the machine that takes them.
const newContext = async (theme) => {
    const context = await browser.newContext({
        viewport,
        deviceScaleFactor: 2,
        baseURL: baseUrl,
        locale: "en-US",
        timezoneId: "UTC",
    });
    // ThemeProvider reads the theme from localStorage before the first render. The key is
    // STORAGE_KEYS.theme in server/frontend/src/lib/storageKeys.ts.
    await context.addInitScript((value) => localStorage.setItem("kasm.app.theme", value), theme);
    return context;
};

// The dashboard keeps its WebSocket open, so the network never goes idle for good; the
// pause lets the first live update and the transitions settle. `prepare` sets up the page
// (filters and the like) before the picture is taken.
const shoot = async (page, route, file, prepare) => {
    await page.goto(route);
    await page.waitForLoadState("networkidle").catch(() => {});
    if (prepare) await prepare(page);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(outDir, file) });
    console.log(`${file}  <-  ${route}`);
};

// A page that is one narrow card is cut down to that card plus a margin; docs/stylesheets/extra.css
// shows `login-*` and `agent-*` at their own size instead of stretched to the column.
const shootCard = async (page, route, selector, file, margin = 24) => {
    await page.goto(route);
    const card = page.locator(selector);
    await card.waitFor();
    await page.waitForTimeout(1500);
    const box = await card.boundingBox();
    const x = Math.max(0, box.x - margin);
    const y = Math.max(0, box.y - margin);
    const clip = {
        x,
        y,
        width: Math.min(viewport.width - x, box.width + 2 * margin),
        height: Math.min(viewport.height - y, box.height + 2 * margin),
    };
    await page.screenshot({ path: path.join(outDir, file), clip });
    console.log(`${file}  <-  ${route}`);
};

// A healthy fleet shows the stat cards alone; the open cluster list shows what is behind them.
// Healthy clusters start collapsed, so their hosts are opened by hand.
const expandAll = (page) => page.getByLabel("Expand all rows").click();

const signIn = async (theme) => {
    const context = await newContext(theme);
    const login = await context.request.post("/api/login", { data: { username, password } });
    if (!login.ok()) throw new Error(`Login failed: ${login.status()}`);
    return context;
};

await mkdir(outDir, { recursive: true });

// The login page, before anyone is signed in, and the agent's own status page.
{
    const context = await newContext("light");
    const page = await context.newPage();
    await shootCard(page, "/login", ".glass-card", "login-form.png");
    await shootCard(page, `${agentUrl}/status`, "#status-container", "agent-status.png");
    await context.close();
}

{
    const context = await signIn("light");
    const page = await context.newPage();

    const api = async (route) => (await context.request.get(route)).json();
    const clients = await api("/api/v1/clients");
    const clusters = await api("/api/v1/keepalived/clusters");
    const webhooks = await api("/api/v1/webhooks");

    const client = clients.find((c) => c.status === "online") ?? clients[0];
    const cluster = clusters[0];
    if (!client || !cluster) throw new Error("No clients or clusters yet, see docs/development.md");
    const clusterRoute = cluster.site ? `/clusters/${cluster.site}/${cluster.vrid}` : `/clusters/${cluster.vrid}`;

    await shoot(page, "/?panel=clusters", "dashboard-light.png", expandAll);
    await shoot(page, "/clusters", "clusters.png", expandAll);
    await shoot(page, clusterRoute, "cluster-detail.png");
    await shoot(page, "/clients", "clients.png");
    await shoot(page, `/clients/${client.id}`, "client-detail.png");
    await shoot(page, "/clients/new", "add-client.png");
    // The view opens on the unseen warnings; the whole history tells more.
    await shoot(page, "/activity", "activity.png", async (p) => {
        await p.getByLabel("Filter by seen state").selectOption("all");
        await p.getByLabel("Filter by level").selectOption("info");
    });
    await shoot(page, "/webhooks", "webhooks.png");
    if (webhooks[0]) await shoot(page, `/webhooks/${webhooks[0].id}`, "webhook-editor.png");
    await shoot(page, "/settings", "settings.png");
    await context.close();
}

// The dashboard once more in the application's default theme, the other half of the pair
// docs/index.md switches with the reader's colour scheme.
{
    const context = await signIn("dark");
    await shoot(await context.newPage(), "/?panel=clusters", "dashboard-dark.png", expandAll);
    await context.close();
}

await browser.close();
