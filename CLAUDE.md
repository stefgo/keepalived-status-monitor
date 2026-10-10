# Keepalived Status Monitor — CLAUDE.md

## Project Overview

A monorepo for monitoring keepalived (VRRP) across multiple hosts. Abbreviated **kasm**.
Consists of:
- **server/backend** — Fastify API server (control plane)
- **server/frontend** — React SPA
- **client** — Lightweight Node.js agent daemon running next to keepalived on each host
- **shared** — Common TypeScript types, Zod schemas, constants

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js 22+, Fastify 5, SQLite (better-sqlite3), Pino |
| Frontend | React 19, Vite 7, TanStack Query 5, Zustand, Tailwind CSS 3, React Router 7 |
| Client | Node.js, Fastify 5, ws — reads keepalived via signals and `/proc/<pid>/root` |
| Shared | TypeScript, Zod 4 |
| Auth | JWT + optional OIDC |
| DB Migrations | Umzug |
| UI Components | @stefgo/react-ui-components |
| Icons | lucide-react |

## Monorepo Structure

```
keepalived-status-monitor/
├── shared/              # Types, Zod schemas, constants
├── client/              # keepalived host agent
├── server/
│   ├── backend/         # Fastify REST + WebSocket API
│   └── frontend/        # React SPA (Vite)
├── docs/                # Documentation, published to GitHub Pages (mkdocs.yml)
├── docker/              # Dockerfiles; docker/dev/ holds the dev keepalived configs
├── scripts/             # Build/version scripts
├── compose.yaml         # Production Docker Compose
└── compose.dev.yaml     # Dev stack: server, two keepalived nodes, one agent each
```

## Development Commands

```bash
# Root-level
npm run dev:server       # Backend in watch mode
npm run dev:frontend     # Frontend dev server (Vite)
npm run dev:client       # Client in watch mode
npm run build            # Build all workspaces
npm run clean            # Clean build artifacts
npm run lint             # ESLint over shared, client and server/backend
npm run lint:frontend    # ESLint over server/frontend (its own config)
npm test                 # Vitest over shared, the frontend, client and backend, once
npm run test:watch       # Vitest, re-running what a change touches
npm run screenshots      # docs/assets/screenshots from a running server (see docs/development.md)

# Frontend only (server/frontend)
npm run lint                 # ESLint
npm run typecheck            # tsc against the installed UI library, then over vite.config.ts
npm run typecheck:local-ui   # tsc against a sibling checkout of the UI library
```

The Vite build does not type-check, so `typecheck` is the frontend's only type gate. Its
second run covers `vite.config.ts` through `tsconfig.node.json`, the files Node runs rather
than the browser.

`build` names its workspaces one by one instead of using `--workspaces`, because
`shared` has to be built first and the others need its output. `--workspaces` would
build `shared` a second time, and its ordering would rest only on the position of
`shared` in the `workspaces` array. **A new workspace has to be added to that list by hand.**

There is no `start:frontend`: the frontend is a Vite SPA that builds into
`server/dist/public`, which the backend serves itself (see `server/backend/src/index.ts`).
`npm run start:server` therefore serves the frontend too. To look at a production
bundle without the backend, use `npm run preview -w server/frontend`.

## Architecture Patterns

### Backend (server/backend)
- **Controller** → handles HTTP/WS routes
- **Service** → business logic (AuthService, KeepalivedStateService)
- **Repository** → data access (UserRepository, ClientRepository, etc.)
- SQLite with WAL mode; schema managed via Umzug migrations in `migrations/`

### Frontend (server/frontend/src)
- Feature-based structure under `features/` (dashboard, keepalived, clients, activity, users, auth, tokens, webhooks, settings, app)
- What the server holds lives in one TanStack Query cache (`lib/queryClient.ts`), read through
  the modules in `queries/` and addressed by `lib/queryKeys.ts`. Zustand holds only
  `useUIStore`, what this browser alone knows.
- Every request goes through `lib/api.ts`, which parses the answer against a schema from
  `shared/src/responses.ts` and throws the server's reason on a refusal. `apiFetch` stays
  below it; no component calls `fetch`.
- A dashboard message changes a cache entry through a pure function in `lib/cacheUpdates.ts`.
  The messages are one union in `shared/src/dashboardMessages.ts`; the backend sends through
  it, and the socket handler's `switch` ends in `assertNever`.
- A lost socket is said: `isLost` in `WebSocketContext` turns true `LOST_AFTER_MS` (5 s) after
  the socket is gone and drives the library's `ConnectionBanner` and `StatusDotProvider`.
  After a reconnect everything the server does not push on connect (`isPushedOnConnect` in
  `lib/queryKeys.ts`) is invalidated. A new cache area the server pushes on connect has to
  be added there.
- Every path lives once in `lib/paths.ts` (`ROUTES`, `paths`, `clusterPath`). No path literal
  anywhere else. The route tree in `features/app/routes.tsx` is the one description of what
  lives where: the sidebar (`handle.nav`), the document title (`lib/pageTitle.ts`), "back"
  (`useBackPath`, the route above -- never `location.state`) and the `errorElement` are all
  read off it. A new page is a route there, with its lazy import in `lazyPages.ts`.
  The breadcrumb in a page's header (`HeaderBreadcrumb`, `lib/breadcrumb.ts`) is read off
  the same handles as the title; a page below a list uses it as its heading.
- A route whose subject is gone for good throws `NotFoundError` (`lib/notFound.ts`); a
  cluster, which comes back with the next reading, says "not found" itself.
- An editor keeps its draft in `useEntityForm`, checked against the request schema from
  `shared`; its rules are pure and live in the feature's `lib/<name>Form.ts`, with a test.
  Leaving a page with unsaved changes is asked about in one place, `useUnsavedChangesGuard`
  (the router's blocker); an editor navigates away with its `close` or `leave`, never with
  `navigate` of its own.
- VRRP clusters are derived, never stored: `buildVrrpClusters` in `shared` is used by the
  backend endpoint and by the dashboard (`useVrrpClusters`) alike. The hook names every
  member's host (`member.hostName`); no view looks a client up for its name.
- A list describes its columns once, as `DataColumnDef[]` (`columns`), with `actionsColumn`
  and `listGroups` from the library; its `emptyMessage` is an `EmptyState`, a search without
  a hit a `noResultsMessage`. The search goes to the view as `searchFilter`, never applied
  to `data` beforehand, or the view cannot tell the two apart.
- Dates follow the browser's locale (`formatDate`, `formatTime` in `utils.ts`; no locale
  literal). "How long ago" is `<RelativeTime>` on `useNow`, the date in its tooltip.
- "Client" is the kasm agent registered with the server, "host" the machine keepalived runs
  on. Both words are used on purpose; neither is renamed into the other.
- React Contexts: WebSocketContext, AuthContext. The theme is the library's `ThemeProvider`,
  mounted with `STORAGE_KEYS.theme`
- Every key in the browser's storage lives once in `lib/storageKeys.ts` (`STORAGE_KEYS`,
  written `kasm.<area>.<what>`). No key literal anywhere else; renaming one forgets the
  stored value and needs no migration.
- Vite proxies `/api` and `/ws` to backend in dev

### Client (client)
- Persistent WebSocket connection to server
- `KeepalivedService` finds keepalived's parent in `/proc`, sends SIGUSR1/SIGUSR2, reads
  the dumps through `/proc/<pid>/root`, and reports state changes as activity events
- A reading is started by the timer, the notify FIFO (`NotifyFifoWatcher`) or the notify
  endpoint (`POST /api/keepalived/notify`), each switched on separately. FIFO and endpoint
  only trigger; the data always comes from the dumps
- Parsers take over named fields only — `auth_pass` must never reach the wire
- Optional built-in Fastify web server

### Shared (shared)
- Single source of truth for types and validation across all workspaces
- Always build shared first when making type changes: `npm run build -w shared`
- Two entry points: `@kasm/shared` (types, schemas, constants — imported by the frontend)
  and `@kasm/shared/node` (Node-only code, currently the pino logger). Anything that needs
  Node goes behind `/node`, or it lands in the browser bundle.

## Configuration

- Server config: `server/config.yaml` (from `config.example.yaml`)
- Client config: `client/config.yaml` (from `config.example.yaml`)
- `VITE_USE_LOCAL_UI` / `VITE_UI_COMPONENTS_PATH` (shell environment of the frontend
  build, not read from `.env`): set `VITE_USE_LOCAL_UI=true` to build against a sibling
  checkout of `@stefgo/react-ui-components` instead of the installed package
  (default path `../react-ui-components`). **Off by default**, so a build never depends
  on a checkout that CI and containers do not have. Vite, Tailwind and
  `tsconfig.local-ui.json` (`npm run typecheck:local-ui`) all switch on it; use them
  together, or the compiler and the bundler see two versions of the same module.
  Tailwind swaps the **preset** as well as its content glob: the preset carries the theme,
  so a local build on the installed preset would run new components on the old theme.

## Code Style

- **Indentation**: 4 spaces in all workspaces and config files, no tabs. No formatter is
  configured — match the surrounding file.
- **Linting**: two configs, one per kind of code, because a file must not be matched by
  both. `eslint.config.mjs` at the root covers `shared`, `client` and `server/backend`
  (js, mjs, ts; Node globals; typescript-eslint recommended, no type information) and
  ignores `server/frontend`; `server/frontend/eslint.config.js` covers the frontend's
  `src/**/*.{ts,tsx}` and adds react-hooks and react-refresh. A new Node workspace is
  covered by the root config without another file. Errors fail the run; no rule is
  downgraded to a warning. `prefer-const` runs with `ignoreReadBeforeAssign`, for the
  `let` a closure reads before anything assigns it.
  A context is split into a JSX-free `XContext.ts` (context object and hook) and an
  `XProvider.tsx`, so `react-refresh/only-export-components` stays an error.
  `react-hooks/set-state-in-effect` is an error too: a loader lives inside its effect and
  sets state only after an `await` (a reload bumps a counter the effect depends on), and
  state derived from props is reseeded while rendering, not in an effect.
- **Quotes**: double quotes for string literals in every workspace, double quotes for JSX
  attributes. Template literals where they earn it. There is no formatter, so this is a rule
  rather than a setting: what matters is that a file does not mix the two.
- **Language**: TypeScript throughout

## Commits

- **Conventional Commits**, checked locally by `.githooks/commit-msg` against
  `commitlint.config.mjs`. The root `prepare` script sets `core.hooksPath` on every
  `npm install`. `ci.yml` lints commits only on pull requests, and this repository is
  maintained without them, so the hook is the check that actually runs.
- **With `bump: auto` the commit type is the only input the version number comes from**: `feat` raises the
  minor, `fix`, `perf` and `revert` the patch, every other type releases nothing.
- **Commit messages are written in English** — subject and body. The existing history is
  German and stays as it is; the rule applies going forward.
- **No `!` in the header** (`feat!: …` is rejected by the `no-breaking-bang` rule): the
  Angular preset semantic-release reads commits with does not know it, so such a commit
  would release nothing. A breaking change is declared with a `BREAKING CHANGE:` footer,
  which raises the **minor** position, not the major one.
- **A body line that starts with one word and a colon** (`happened: …`) is parsed as the
  start of the footer. Rephrase it.
- `subject-case` is off, so an English subject in sentence case is fine
  (`fix: Validate the settings before saving them`).
- Release commits (`chore(release): x.y.z`) are exempt from commitlint; their body is the
  generated release notes.
- `.githooks/pre-push` allows pushing `main` and `dev` only; topic branches stay local.

## Versioning and Releases

`semantic-release` owns the version. It runs from `.github/workflows/release.yml`, which is
**`workflow_dispatch` only and releases from `main` (a release) or `dev` (a beta,
`x.y.z-beta.n`)**: a release is an action, not a side effect of pushing. **Never bump a
version or create a `v*` tag by hand.**

The workflow calls [stefgo/release-workflows](https://github.com/stefgo/release-workflows),
which carries semantic-release and its configuration for every stefgo project. There is no
`release` entry in `package.json` and no semantic-release package installed here.

- Inputs: `dry_run` (default on) shows the next version and the complete notes and changes
  nothing; `bump` (`auto` | `patch` | `minor` | `major`) takes the step from the commit types
  or is the step itself, whatever the commits say. `major` is the only way a major version is
  created. A run that was asked for and produces no release fails.
- **Every release needs hand-written notes in `.release/next.md`** — what is new, what an
  upgrade needs. They go above the generated list of commits; without them the workflow
  refuses. A beta keeps the text, the release from `main` empties the file. Write it as part
  of the change that deserves a sentence, not at release time.
- **`dev` is merged into `main` with its history — never squashed or rebased** — and `main`
  back into `dev` before the next beta. The workflow checks both and refuses otherwise.
- The root `package.json` is the single source of truth for the version. It starts at
  `0.0.0`; without a release tag semantic-release makes the first release `1.0.0`. The
  workspace manifests keep `1.0.0` and nothing reads them.
- semantic-release pushes the tag over `GITHUB_TOKEN`, which starts no workflow, so
  `release.yml` dispatches `build.yml` on the tag ref itself and waits for it. That build is
  what moves `latest`.
- A push to `main` or `dev` publishes the rolling `:main` / `:dev` image plus `sha-<short>`
  — no tag, no version, no changelog entry.
- The version string is derived in one order everywhere: build argument, then the root
  `package.json` (with `+<hash>` when the commit carries no release tag), then git. The
  order lives in `scripts/generate-version.sh` and, mirrored, in
  `server/frontend/vite.config.ts`. Only the client agent ships a `dist/VERSION` file.

## Testing

Vitest, configured in `vitest.config.mts` at the root with one project per workspace:
`shared`, `frontend`, `client` and `backend`. All run in plain Node, so what is tested is
logic — nothing renders a component or starts the backend.

- A test lives next to its module (`vrrpCluster.ts`, `vrrpCluster.test.ts`).
- Every project but `shared` sets the `development` condition, so its tests read
  `shared/src` and need no build first.
- `shared`, `client` and `server/backend` build with `tsconfig.build.json`, which keeps the
  tests out of `dist`; `npm run typecheck -w <workspace>` is what type-checks them.
- Logic inside a class with side effects is moved into a pure module first and tested there.
- A backend module that imports `core/Database.js` or `config/AppConfig.js` reads the real
  `server.db` and `config.yaml` the moment it is imported. Its test replaces both with
  `vi.mock`; `src/testing/memoryDatabase.ts` gives an in-memory database on the current
  schema. **No test may open the files of a running installation.**

CI (`.github/workflows/ci.yml`) runs `npm run build`, `npm test`, `npm run typecheck` for
`shared`, `client`, `server/backend` and `server/frontend`, `npm run lint -w server/frontend`
and `npm run lint` on every branch and pull request; `build.yml` calls the same workflow and
only builds images once it passes. Run the eight locally before pushing.

## Docs

See `docs/` for detailed documentation:
- `docs/index.md` — Landing page of the published site; **not** a copy of the README, and
  the only page that exists solely for the site
- `docs/api.md` — REST and WebSocket API
- `docs/backend.md` — Backend architecture
- `docs/frontend.md` — Frontend structure
- `docs/client.md` — Client agent architecture
- `docs/development.md` — Development guidelines, the documentation site itself
- `docs/quickstart.md` — Server and first agent with Docker Compose
- `docs/configuration.md` — Both `config.yaml` files, faster failover detection, env vars
- `docs/security.md` — Reverse proxy, TLS, address checks, stored secrets, agent permissions
- `docs/operations.md` — Images and tags, upgrading, backup, health, logs
- `docs/upgrade-notes.md` — What a release changes for a running installation, newest
  first; **a change an operator has to act on gets an entry here**
- `docs/webhooks.md` — Webhooks: filters, body templates, examples

### The docs are rendered twice

`docs/` is both the GitHub-browsable directory and the `docs_dir` of
[`mkdocs.yml`](mkdocs.yml) (MkDocs Material), published to
<https://stefgo.github.io/keepalived-status-monitor/> by
[`docs.yml`](.github/workflows/docs.yml) on pushes to `main`. **Every page has to
render in both**, which constrains three things:

- **A link out of `docs/` must be absolute**
  (`https://github.com/stefgo/keepalived-status-monitor/blob/main/…`). A relative
  `../compose.yaml` resolves on GitHub and nowhere else — MkDocs cannot follow a path
  outside its `docs_dir`, and `--strict` fails the build on it. Links between pages
  inside `docs/` stay relative.
- **`api.md` has a hand-written TOC with GitHub anchors** — the emoji is dropped and
  the leading space becomes a dash (`#-authentication`). `mkdocs.yml` sets
  `pymdownx.slugs.slugify(case=lower)` for exactly that reason. Changing the slugify
  function silently breaks those links.
- **A new page has to be added to `nav` in `mkdocs.yml`**; `--strict` fails on a page
  outside the navigation.

The workflow is deliberately **not** part of `ci.yml`/`build.yml`: that chain is the
gate on a release, and a documentation typo must not block one. The strict build runs on
every branch that touches the docs; only `main` deploys.
