# Development & Deployment Guide

This document describes the setup of the development environment as well as build management and deployment for the Keepalived Status Monitor.

## Development Environment

Development is performed inside Docker containers to ensure a consistent, platform-independent environment.

### Prerequisites

- Docker and Docker Compose (or Docker Desktop)
- A `.env` file in the root directory (excluded from git). Must contain at minimum:

```env
NPM_TOKEN=<your-token>
```

### Starting the Development Environment

The development environment is configured via `compose.dev.yaml`:

```bash
NPM_TOKEN=$(gh auth token) docker compose -f compose.dev.yaml up --build
```

This starts a server, two keepalived nodes and one agent next to each:

| Service        | Port   | Dockerfile                        | Description                                                                                     |
| :------------- | :----- | :-------------------------------- | :---------------------------------------------------------------------------------------------- |
| `server-dev`   | `3010` | `docker/Dockerfile.server.dev`    | Backend in watch mode (`npm run dev -w server/backend`), restarting on code changes. It serves the frontend from `server/dist/public` once that has been built; for hot reload run `npm run dev:frontend` on the host, whose Vite server proxies `/api` and `/ws` to port 3010. |
| `keepalived-a` | —      | `docker/Dockerfile.keepalived.dev` | keepalived with `docker/dev/keepalived-a.conf`: MASTER of VRID 51 (`VI_WEB`, in sync group `VG_DEV`), BACKUP of VRID 52 (`VI_DB`). Unicast between the two nodes on a fixed subnet, `172.28.0.0/24`. |
| `keepalived-b` | —      | same                              | The mirror image: BACKUP of 51, MASTER of 52.                                                   |
| `client-a`     | `3011` | `docker/Dockerfile.client.dev`    | Agent in watch mode, in `keepalived-a`'s PID and network namespace — the view the production agent has with `pid: host` and `network_mode: host`. |
| `client-b`     | `3012` | same                              | Agent next to `keepalived-b`.                                                                   |

Register the agents through their web UIs (`http://localhost:3011`, `:3012`) with the server
URL `http://172.28.0.10:3010`; the setup PINs are in `docker logs kasm-client-a` /
`kasm-client-b`. Each agent keeps its `config.yaml` and data in a volume of its own
(`KASM_CLIENT_CONFIG`, `KASM_CLIENT_DATA_DIR`), since both run from the same `client/`.

**Failover on demand.** Both nodes track `/tmp/kasm-fault`:

```bash
docker exec kasm-keepalived-a sh -c 'echo 1 > /tmp/kasm-fault'   # node A → FAULT, B takes over
docker exec kasm-keepalived-a sh -c 'echo 0 > /tmp/kasm-fault'   # A recovers and takes VI_WEB back
```

Stopping `keepalived-a` instead would take `client-a` with it, which shares its namespaces.
After recreating a keepalived container, recreate its agent too.

**Volume mounts:**
- `server/`, `shared/` → mounted into `server-dev` for live code editing.
- `client/`, `shared/` → mounted into both agents.
- `node_modules` is isolated as a Docker volume per service to prevent conflicts between host OS (macOS/Windows) and Linux container dependencies.
- `../react-ui-components` (a sibling checkout of `@stefgo/react-ui-components`) is mounted into `server-dev` at `/app/react-ui-components`, and it sets `VITE_USE_LOCAL_UI=true` to build against it. The mount is unconditional: without the checkout Docker mounts an empty directory, and a frontend build inside the container fails.

**UI library outside the dev containers:** a plain `npm run build` or `npm run dev:frontend` uses the installed library version. Building against a sibling checkout is opt-in with `VITE_USE_LOCAL_UI=true`, type-checked with `npm run typecheck:local-ui -w server/frontend`. See [frontend.md](frontend.md#working-against-a-local-checkout-of-the-ui-library).

## Documentation Site

The pages in `docs/` are served twice: GitHub renders them as plain Markdown, and
[MkDocs Material](https://squidfunk.github.io/mkdocs-material/) publishes them to
<https://stefgo.github.io/keepalived-status-monitor/>. **A page has to work in both.**
Three things follow from that:

- **Links out of `docs/` have to be absolute.** A relative `../compose.yaml` resolves on
  GitHub and nowhere else. Use the full `https://github.com/stefgo/keepalived-status-monitor/blob/main/...`
  URL instead.
- **The hand-written table of contents in `api.md` uses GitHub's anchors** — the emoji is
  dropped and the leading space becomes a dash, hence `#-authentication`. `mkdocs.yml`
  configures `pymdownx.slugs.slugify(case=lower)` precisely so that MkDocs produces the
  same ids. Do not swap the slugify function without checking those links.
- **A new page needs an entry in `nav`** in `mkdocs.yml`. `index.md` is the landing page of
  the site and not a copy of the README.

To preview locally:

```bash
python3 -m venv .venv-docs && source .venv-docs/bin/activate
pip install -r requirements-docs.txt
mkdocs serve          # http://localhost:8000, live reload
```

`requirements-docs.txt` pins the version, so the preview and the published site render
identically.

`.github/workflows/docs.yml` runs `mkdocs build --strict` on every branch and pull request
that touches the documentation — a dead internal link, a nav entry without a file or a page
outside the nav fails it. Only `main` deploys the result to GitHub Pages (**Settings → Pages
→ Source: GitHub Actions**). The workflow is deliberately separate from `ci.yml` and
`build.yml`: a typo in a page must not be able to block a release, and a documentation-only
commit builds no image.

### Screenshots

There are none yet. The screenshot generator of the project KASM started from
(`scripts/screenshots`, Playwright against fixtures) was left behind with the Docker views
it captured; it can come back with VRRP fixtures. Until then, `index.md` describes the
dashboard in words.

## Build Management

Production images use multi-stage Docker builds:

| Component        | Dockerfile                  |
| :--------------- | :-------------------------- |
| Server           | `docker/Dockerfile.server`  |
| Client           | `docker/Dockerfile.client`  |

**Build stages:**
1. **`builder`**: Installs all dependencies, builds all TypeScript workspaces (`shared`, `client`, `server/frontend`, `server/backend`).
2. **`runner`**: Copies only compiled output and production dependencies into a slim base image (`node:22-bookworm-slim` or `debian:bookworm-slim`). The builder removes the dev dependencies with `npm prune --omit=dev`, which works on the installed tree — no second registry round trip and no rebuild of `better-sqlite3`.

`.dockerignore` keeps `node_modules`, build output, databases, `config.yaml`, `.env`, `.git` and the docs out of the build context; everything an image needs is copied explicitly.

### Version Injection

The version string is derived in the same order everywhere — by `scripts/generate-version.sh` for the agent's `dist/VERSION` file, and by `getVersion()` in `server/frontend/vite.config.js` for the dashboard:

1. `APP_VERSION` / `VITE_APP_VERSION`. CI passes the released version (`1.2.0`, without the `v` of the tag) or `<branch>-<short-sha>` for a branch build.
2. The version in the root `package.json`, which semantic-release maintains. On a commit that carries a release tag it is used as it is; otherwise the commit is appended (`1.2.0+abc1234[-dirty]`), so a build between releases never looks like the release.
3. Fallback without a readable manifest: `{branch}-{short-hash}[-dirty]`.

The server ships no `VERSION` file; nothing on the backend reads one.

### Multi-Architecture Support

Both the server and client images are built for multiple platforms:

| Component | Supported Platforms                  |
| :-------- | :----------------------------------- |
| Server    | `linux/amd64`, `linux/arm64`         |
| Client    | `linux/amd64`, `linux/arm64`         |

Each architecture is built on a native GitHub runner (`ubuntu-latest` and `ubuntu-24.04-arm`), without QEMU, and pushed by digest only. Once the smoke test has started those digests, a publish job assembles one manifest list per image and attaches the tags, so `docker pull` picks the right variant on either platform.

### Continuous Integration

There are no automated tests, so type checking and linting are the quality gates. Every job declares its own `permissions`, and every workflow has a `concurrency` group; a tag build is never cancelled.

| Workflow | Trigger | What it does |
| :------- | :------ | :----------- |
| **Check Code** (`ci.yml`) | Push to any branch except `main`, every pull request, and `workflow_call` | Job `verify`: checks that the registry cleanup names every image `build.yml` publishes, then `npm ci`, `npm run build` (type-checks `shared`, `client` and `server/backend`, builds the frontend), `npm run typecheck -w server/frontend` (the Vite build does not type-check), `npm run lint -w server/frontend`, `npm run lint` (the root ESLint config, covering `shared`, `client` and `server/backend`). |
| **Build Images** (`build.yml`) | Push to `main` or `dev` (except documentation-only commits), `v*.*.*` tags, manual dispatch — which is how a release reaches it | See the job graph below. |
| **Create Release** (`release.yml`) | Manual, `main` only | See [Release](#release). |
| **Prune Registry** (`cleanup-packages.yml`) | Nightly, manual | See [Registry Cleanup](#registry-cleanup). |
| **Merge Dependency Updates** (`dependabot-auto-merge.yml`) | Pull requests by Dependabot | See [Action Updates](#action-updates). |
| **Publish Docs** (`docs.yml`) | Push and pull request touching `docs/`, `mkdocs.yml` or `requirements-docs.txt`, manual | See [Documentation Site](#documentation-site). |

`build.yml` runs these jobs:

```
verify ──► prepare ──► build (server, client × amd64, arm64) ──► smoke (amd64, arm64) ──► publish
(ci.yml)                 native runners, pushed by digest,          starts each digest        manifest lists
                         no tag yet                                                           and every tag
```

- **`verify`** is `ci.yml`, reused rather than restated. Nothing is built before it is green.
- **`prepare`** is the single source of the version string and of the two image names.
- **`build`** runs four native jobs that push by digest, with a GHA layer cache per image and architecture. Each hands its digest on as a workflow artefact.
- **`smoke`** starts the digests of its architecture, see below.
- **`publish`** assembles one manifest list per image from both digests and attaches `main` or `dev` and `sha-<short>`, or — for a release — the version tags and `latest`. It is the first job that makes anything pullable.

A build that fails the smoke test leaves its digests in the registry untagged; the nightly cleanup removes them. `paths-ignore` (`docs/**`, `mkdocs.yml`, `requirements-docs.txt`, `.github/workflows/docs.yml`, `**.md`) applies to branch pushes only — a tag or a manual run always builds.

`npm ci` authenticates against GitHub Packages for `@stefgo/react-ui-components` with the workflow's `GITHUB_TOKEN` (`packages: read`). That works because the package is public; if it ever becomes private, the step needs a personal access token with `read:packages` instead. The image builds pass the same `GITHUB_TOKEN` as the `npm_token` BuildKit secret. The former `NPM_TOKEN` repository secret, a personal access token with an expiry date, is no longer read.

**Smoke test.** The `smoke` job is the only place where the images are executed: everything before it proves that the code compiles, not that the result starts. **It is a gate, not a report** — nothing is tagged until it has passed, so `latest` cannot move to an image that never started. It runs on both architectures, each on its native runner, and addresses the images as `<image>@sha256:…` from the artefacts of this run: there is no tag yet, and a digest leaves nothing for Docker to choose. It starts the server and the agent (which, with no keepalived on the runner, reports it as not running and idles) and waits up to 60 s each for `{"status":"ok"}` from `/api/health`. On failure it prints the container logs.

To reproduce the gate locally, run the same four commands without `VITE_USE_LOCAL_UI` set:

```bash
npm run build
npm run typecheck -w server/frontend
npm run lint -w server/frontend
npm run lint
```

ESLint is configured twice, once per kind of code: [`eslint.config.mjs`](https://github.com/stefgo/keepalived-status-monitor/blob/main/eslint.config.mjs) at the root lints `shared`, `client` and `server/backend` as Node TypeScript and ignores `server/frontend`, which has its own config with the React plugins. Two configs matching the same file would be two truths about it; a new Node workspace, on the other hand, is covered by the root config without another file.

### Registry Cleanup

[`cleanup-packages.yml`](https://github.com/stefgo/keepalived-status-monitor/blob/main/.github/workflows/cleanup-packages.yml) prunes GHCR every night at 02:00. It uses `dataaxiom/ghcr-cleanup-action` rather than the more obvious `actions/delete-package-versions`, and the reason is worth keeping: a multi-arch build pushes its per-architecture images and its attestations **untagged** — only the manifest list carries the tag.

```
kasm-server:main  ─┬─► sha256:6612…  linux/amd64      ┐
                  ├─► sha256:3695…  linux/arm64      │ each one an untagged
                  ├─► sha256:c2c3…  attestation      │ version of the package
                  └─► sha256:77e4…  attestation      ┘
```

An action that deletes "untagged versions" therefore hollows out the tagged images from underneath. That is not hypothetical: in the project KASM started from it left `latest` and several release tags with children that all returned 404 — `docker pull` failed on them. The previous `ignore-versions` regex could not prevent it, because it is matched against the version name, which for a container package is the digest.

The cleanup in use knows which children belong to a kept tag, and `delete-partial-images` removes the manifests that already lost theirs. `latest`, `main`, `dev` and anything shaped like a version are excluded from every rule — a deleted `1.2.0` breaks whoever pinned it, so release images accumulate. The exclusion also keeps the already broken tags above in place; `latest` becomes pullable again with the next release.

`validate: true` re-checks the result, but only as a warning. A step of the workflow's own therefore resolves every child digest of `latest`, `main` and `dev` individually and **fails** on a missing one — a hollowed-out image still lists its platforms in the index, only fetching the child shows that it is gone. A failing scheduled run is what GitHub sends a notification about. Until the next release replaces the broken `latest`, that step is expected to fail.

A manual run defaults to a dry run:

```bash
gh workflow run cleanup-packages.yml               # logs only
gh workflow run cleanup-packages.yml -f dry_run=false
```

The images are listed by name in the workflow; a new image has to be added there by hand. `ci.yml` fails when `build.yml` publishes an image that list does not name. Discovering the packages by wildcard would need a classic personal access token with `delete:packages` — an unattended delete right over every container of the account, and a credential that expires.

### Action Updates

`.github/dependabot.yml` watches the GitHub Actions, and only those: one grouped pull request a month, prefixed `ci:`, aimed at `dev`. npm is left out on purpose — four workspaces produce a stream of version bumps that nobody can assess without a test suite. Dependabot security updates for npm arrive regardless, they need no configuration file.

This repository is maintained without pull requests, so a monthly one would simply wait. `dependabot-auto-merge.yml` puts a Dependabot pull request into auto-merge, and GitHub merges it once its checks are green; a red run leaves it open. It targets `dev` because an action bump mostly concerns actions only `build.yml` exercises, and that runs after a merge — on `dev`, a bad bump breaks the developer image, and its smoke test says so.

It needs **"Allow auto-merge"** enabled under *Settings ▸ General ▸ Pull Requests*. Without it the workflow fails loudly instead of merging unchecked.

[`SECURITY.md`](https://github.com/stefgo/keepalived-status-monitor/blob/main/SECURITY.md) describes how to report a vulnerability privately.

### Commit Messages

Commits follow [Conventional Commits](https://www.conventionalcommits.org/) and are written in English. The commit message is the **only** input the version number comes from, so it is checked like code: `.githooks/commit-msg` runs commitlint against `commitlint.config.mjs`. `ci.yml` lints the commits of a pull request as well, but this repository is maintained without pull requests, so the hook is the check that actually runs. `npm install` activates the hooks through the root `prepare` script:

```bash
git config core.hooksPath .githooks   # runs automatically via `npm install`
```

| Type | Effect on the version |
| :--- | :--- |
| `feat` | minor — 1.2.0 → 1.3.0 |
| `fix`, `perf`, `revert` | patch — 1.2.0 → 1.2.1 |
| `build`, `chore`, `ci`, `docs`, `refactor`, `style`, `test` | none |

- A breaking change is declared with a `BREAKING CHANGE:` footer. It raises the **minor** position (`releaseRules` in `package.json`) and still gets its own section in the changelog. A major version comes only from the release workflow's `bump: major`.
- The `feat!:` spelling is rejected: the Angular preset semantic-release reads commits with has no `!` in its header pattern, so such a commit would be read as typeless and release nothing.
- A body line that begins with a single word and a colon (`happened: …`) is parsed as the start of the footer. Rephrase it.
- Release commits (`chore(release): x.y.z`) are exempt from commitlint: their body is the generated release notes, and the release job's `npm ci` activates the hook too.
- `[skip release]` anywhere in a message removes that commit from the version calculation.
- `.githooks/pre-push` allows pushing `main` and `dev` only; topic branches stay local.
- `core.hooksPath` makes git ignore `.git/hooks`. A hook of your own belongs in `.githooks`.

### Release

`semantic-release` owns the version number; nobody tags by hand. A release is started from *Actions ▸ Create Release ▸ Run workflow* on `main` — [`release.yml`](https://github.com/stefgo/keepalived-status-monitor/blob/main/.github/workflows/release.yml) rejects every other branch in a `guard` job, before the checks run.

```
Actions ▸ Create Release ▸ Run workflow   (main)
  └─► guard ─► ci.yml ─► semantic-release
        ├─ commits CHANGELOG.md + package.json   [skip ci]
        ├─ pushes tag v1.2.0, creates the GitHub release
        └─ gh workflow run build.yml --ref v1.2.0
              └─► build.yml → images 1.2.0, 1.2, latest
                    └─ gh run watch --exit-status   (the release job waits)
```

- **`dry_run`** (default on) runs `semantic-release --dry-run`: the next version appears in the log, nothing is written.
- **`bump`** (`auto` | `major`): `major` forces a major version regardless of the commits — also from a state that holds only `docs:` commits, which is what the dry run is there to catch.
- A run that was asked for and produces no release **fails** instead of going green without a result.
- The tag is pushed over `GITHUB_TOKEN`, and GitHub starts no workflow for such a push. `release.yml` therefore dispatches `build.yml` on the tag ref and follows it. If that build fails, the last step says that the version exists without images and that re-running *Build Images* on the tag is the fix — not a second release.
- The root `package.json` carries the released version. It starts at `0.0.0`; without a release tag semantic-release makes the first release `1.0.0`. The workspace manifests keep `1.0.0`.

To build an image from another branch, dispatch the build manually. It is tagged with the branch name and the short SHA, never with `latest`:

```bash
gh workflow run build.yml --ref my-branch   # -> :my-branch, :sha-abc1234
```

### Indentation

Four spaces everywhere, no formatter — match the surrounding file. A commit that only
reformats should say so in its subject and change nothing else, so `git blame` can be told to
skip it (`git config blame.ignoreRevsFile` with a file listing its hash).

---

## Deployment

### Running in Production

Deploy on the target host using the production Compose file:

```bash
docker compose pull
docker compose up -d
```

**Production services (`compose.yaml`):**

| Service      | Port   | Volumes                                            | Description            |
| :----------- | :----- | :------------------------------------------------- | :--------------------- |
| `kasm-server` | `3010` | `server-data` (SQLite DB), `./server-config.yaml`  | API + web dashboard.   |
| `kasm-client` | `3011` (host network) | `client-data`, `./client-config.yaml` | Agent, on each keepalived host — with `pid: host`, `KILL`, `SYS_PTRACE` (see [Agent Permissions](install.md#agent-permissions)). |

Both services use `restart: unless-stopped` and declare a `healthcheck` against `GET /api/health` (see [install.md](install.md#health)). Docker does not restart an unhealthy container; the state is for monitoring.

Which tag moves when:

| Trigger | Tags | Moves `latest` |
| :------ | :--- | :------------- |
| Push to `main` | `main`, `sha-<short>` | no |
| Push to `dev` | `dev`, `sha-<short>` | no |
| Release `v1.2.0` | `1.2.0`, `1.2`, `latest` | **yes** |
| Manual dispatch on a branch | `<branch>`, `sha-<short>` | no |

---

## npm Scripts Reference

All scripts are defined in the root `package.json` and target individual workspaces via `-w`.

| Script           | Description                                                 |
| :--------------- | :---------------------------------------------------------- |
| `dev:server`     | Start backend in watch/dev mode.                            |
| `dev:frontend`   | Start frontend Vite dev server with HMR.                    |
| `dev:client`     | Start client agent in watch/dev mode.                       |
| `start:server`   | Start backend in production mode.                           |
| `start:client`   | Start client agent in production mode.                      |
| `build`          | Build `shared` first, then `client`, `server/backend` and `server/frontend`. |
| `clean`          | Remove compiled output from `shared`, `client`, and `server`. |

There is no `start:frontend`. The frontend builds into `server/dist/public` and is served by the backend, so `start:server` covers it. To serve a production bundle on its own, use `npm run preview -w server/frontend`.

`build` lists its workspaces explicitly rather than using `--workspaces`, which would build `shared` twice and rely on the order of the `workspaces` array. A new workspace has to be added to that list.
