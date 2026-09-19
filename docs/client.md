# 🤖 Client Agent Architecture

This documentation details the architecture of the Node.js client agent (`client/`), which runs next to keepalived on every host the Keepalived Status Monitor watches.

## 🔁 Connection Modes

The two modes are named **from the server's point of view**, and that is the only reading
used anywhere — in `CONNECTION_MODE` (`shared/src/constants.ts`), in the `clients.connection_mode`
column, in the REST API and in the dashboard:

| Mode | Who dials | What the agent needs |
| :--- | :--- | :--- |
| `inbound` | The agent dials the server (`/ws/agent` on the server) | `serverUrl` and an `authToken`; the agent owns the reconnect ladder. The server checks the source address against `clients.inbound_allowed_ip`. |
| `outbound` | The server dials the agent (`/ws/register` and `/ws/agent` on the agent's own web server) | A reachable `listenPort` (default 3011) and a `registrationSecret` for the first contact; the server owns the reconnect ladder and stores the agent's address as `outboundTargetAddress`. |

Read from the agent's side the words invert — an `outbound` client is the one that receives a
connection — so agent-side code and logs name the **mode**, not the local direction.

## 💻 Platform Support

`ghcr.io/stefgo/kasm-client` is one multi-arch image for **x86_64 (`linux/amd64`)** and **ARM64 (`linux/arm64`)**, e.g. a Raspberry Pi; `docker pull` picks the matching variant. See [Container Images](install.md#container-images) for the tags.

## 📂 Project Structure

The client is a lightweight, headless Node.js process designed to run as a daemon (either via Docker or systemd). It maintains a persistent WebSocket connection to the central server and exposes a local web UI for setup and status monitoring.

```
client/src/
├── core/
│   ├── Config.ts              # Configuration management (YAML-based, with authToken storage)
│   ├── Connection.ts          # Persistent WebSocket connection & message routing
│   ├── DataStore.ts           # The agent's data directory: atomic JSON read/write
│   ├── ServerHttp.ts          # HTTP(S) requests to the server, certificate check decided per call
│   ├── SetupPin.ts            # The PIN that guards registration through the web UI
│   └── Version.ts             # Agent version detection (VERSION file, git tags, git hash)
├── services/
│   ├── ActivityService.ts     # Activity events: queue, at-least-once delivery
│   ├── KeepalivedService.ts   # Finds keepalived, signals it, reads the dumps, diffs readings
│   └── parsers/
│       ├── common.ts          # The fields taken over, state names, shared helpers
│       ├── dataDump.ts        # /tmp/keepalived.data (SIGUSR1), text
│       ├── statsDump.ts       # /tmp/keepalived.stats (SIGUSR2), counters
│       └── jsonDump.ts        # /tmp/keepalived.json, for a keepalived built with --enable-json
├── web/
│   ├── server.ts              # Local Fastify HTTP server (listenPort, default 3011)
│   └── public/
│       ├── register.html      # Client registration UI
│       ├── status.html        # Connection and keepalived status
│       ├── styles.css         # Dark-theme stylesheet
│       └── favicon.svg
└── index.ts                   # Application entry point
```

---

## 🏗️ Core Components

### 1. Configuration (`src/core/Config.ts`)

Manages the client's YAML configuration file (`config.yaml`). Supports reading, updating, and persisting configuration while preserving YAML comments.

**Config keys:**

| Key            | Description                                                                 |
| :------------- | :-------------------------------------------------------------------------- |
| `clientId`     | Client UUID issued by the server at registration. Empty until then; never set by hand. |
| `logLevel`     | Log verbosity (`debug`, `info`, `warn`, `error`). Default: `info`.          |
| `serverUrl`    | HTTP(S) URL of the management server (e.g., `https://manager:3010`).        |
| `authToken`    | Permanent authentication token. Populated automatically after registration. |
| `keepalived` | How keepalived is read: `pollInterval` (s, default `5`), `dataFile`, `statsFile`, `jsonFile` (as keepalived sees them), `jsonSignal` (unset: text dump), `dumpTimeoutMs` (default `3000`). Validated on start; an invalid value stops the agent with a log line naming it. |
| `registrationSecret` | Outbound mode only: the secret the server presents on `/ws/register`. Must match the value entered in the dashboard's Add Client wizard; removed from the file after a successful registration. |
| `allowSelfSignedCertificates` | Accept a server certificate that does not validate, for registration and the WebSocket connection. Default `false`. |
| `allowedNetworks` | IPv4 addresses or CIDR networks the server may dial `/ws/register` and `/ws/agent` from. Empty (default) allows every address. |
| `listenPort` | Port of the local web server (default `3011`). `KASM_CLIENT_PORT` wins over it. |
| `enableStatusPage` | Serve `/status` (default `true`). |
| `enableRegisterPage` | Serve `/register` and accept `POST /api/register` (default `true`). |

### 2. WebSocket Connection (`src/core/Connection.ts`)

Manages the persistent WebSocket connection to the server at the `ws/agent` endpoint, presenting `clientId` and `token` in the query string. It does not dial at all until both halves are stored.

- **Authentication**: Sends the `authToken` as a query parameter on connect. Immediately sends an `AUTH` message with `{hostname, version, capabilities}`. `capabilities` is what this build can do (currently `vrrp`); the server reads it instead of comparing version strings, and an agent that predates a capability simply does not name it.
- **Heartbeat**: Server sends a PING every 30 seconds; the client responds with PONG. If no ping is received within 35 seconds, the connection is considered dead and a reconnect is triggered.
- **Reconnection**: After a disconnect or a failed attempt the agent waits 5, 10, 30 and then 60 seconds between attempts, plus up to 3 seconds of random jitter each time, so a fleet does not return in lockstep after a server restart. The ladder is the same as the server's for outbound agents (`ClientConnector`). It restarts at 5 seconds only after a successful `AUTH_SUCCESS`, not merely when a socket opens. An attempt whose handshake does not finish within 5 seconds is terminated and counts as failed. All attempts run through one timer: a manual retry from the status page replaces a queued one, and a socket that has been superseded by a newer connection never schedules a reconnect of its own.
- **Message Routing**: `SERVER_MESSAGE_HANDLERS` is a `type → handler` table, and both message handlers — the connection the agent dials and the one the server dials — dispatch through `routeServerMessage()`. The two branches used to stand once per direction although the server sends the same messages either way. An unknown type is dropped: a server of a newer build may know messages this agent does not. `AUTH_SUCCESS` stays outside the table, in `connect()`, which ties the attempt timeout, the reconnect ladder and the promise it has to settle to it.

**Handled events:**

| Event                  | Direction       | Description                                                                                       |
| :--------------------- | :-------------- | :------------------------------------------------------------------------------------------------ |
| `AUTH`                 | Client → Server | Initial handshake with hostname, version and the agent's capabilities.                           |
| `AUTH_SUCCESS`         | Server → Client | Confirms connection is authenticated and active. Triggers an immediate reading and `KEEPALIVED_UPDATE`. |
| `AUTH_FAILURE`         | Server → Client | Not handled on its own: the server closes the socket right after it, and the agent goes back to its reconnect ladder like after any other close. |
| `KEEPALIVED_UPDATE`    | Client → Server | One reading of keepalived: whether it runs, its version and PID, the VRRP instances and sync groups with their counters. |
| `REQUEST_STATE_UPDATE` | Server → Client | Read keepalived now and send the result, whether or not it changed.                               |
| `ACTIVITY`             | Client → Server | Events the agent has observed and has not had acknowledged yet, as a batch.                        |
| `ACTIVITY_ACK`         | Server → Client | The ids the server stored. The agent drops them from its queue.                                    |

After connect the agent sends a fresh reading at once and offers everything still in its activity queue. From then on a reading goes out whenever it differs from the last one sent — the counters aside — and at least every 30 seconds, so the counters stay current without a broadcast to every dashboard every five seconds.

#### How the protocol may change

Server and agent are updated separately, so every build has to speak to one of another age. Three rules make that possible, and they apply to both directions:

1. **A receiver drops what it does not know.** An unknown message type, an unknown field: noted in the debug log at most, never answered with an error and never a reason to close the connection. This is why most additions need nothing else.
2. **A new field is optional.** Making an existing field mandatory is a break and needs the same two steps as removing one: the sender first, the receiver a release later — never both in the same release.
3. **Vocabularies are read tolerantly.** An unknown value of an enum on the wire is normalised to a known one or passed through as it came; it never makes the message it sits in unusable. `ActivityEventSchema` is the worked example: `kind` is a plain string, `level` and `source` fall back to `info` and `agent`.

What makes the capability mechanism one-directional is an assumption about who is newer: the server updates its agents, so it is in practice never the older of the two. That is why there is only the "server asks what the agent can do" direction and no server capabilities in `AUTH_SUCCESS`. The day an agent offers something an older server would not merely drop but act on wrongly, that direction has to be added — until then it would be a mechanism without a case.

### 3. Local Web Server (`src/web/server.ts`)

A local Fastify HTTP server, used for initial setup and status monitoring. It listens on `listenPort` from `config.yaml` (default **3011**), which `KASM_CLIENT_PORT` overrides. The port matters beyond the web UI: in outbound mode the server dials `/ws/register` and `/ws/agent` on it, so a moved port has to be reflected in the client's target address on the server side.

**Pages:**

| Route       | Description                                                                   |
| :---------- | :---------------------------------------------------------------------------- |
| `GET /`     | Redirects to `/status` if registered, otherwise to `/register`.               |
| `GET /register` | Registration UI — form to enter Server URL and Registration Token.        |
| `GET /status`   | Status dashboard — shows server reachability, auth token, connection state and a one-line keepalived summary. |

**API endpoints:**

| Route                        | Method | Description                                                          |
| :--------------------------- | :----- | :------------------------------------------------------------------- |
| `/api/status/server?url=...` | GET    | Checks if the server is reachable via `GET {serverUrl}/api/v1/ping`. |
| `/api/status/auth`           | GET    | Returns `{hasAuthToken: boolean}`.                                   |
| `/api/status/connection`     | GET    | Returns `{connected: boolean}` (live WebSocket state).               |
| `/api/status/keepalived`     | GET    | The last reading in summary: `{collected, running, version, error, instances, master, collectedAt}`. No instance details — the page has no login. |
| `/api/health`                | GET    | Liveness for the image's `HEALTHCHECK`: `{status: "ok"}` while the agent process answers. Independent of the server connection. |
| `/api/connect`               | POST   | Attempts to establish a WebSocket connection.                        |
| `/api/register`              | POST   | Performs registration: checks the setup PIN, then calls `POST {serverUrl}/api/v1/register`. Body `{url, token, pin}`; `400` names the invalid field (`url` must be http or https), `403` on a wrong PIN. Only available while `enableRegisterPage` is not `false`. |

**WebSocket routes (server dials the agent):** `/ws/register` and `/ws/agent` first check the peer address against `allowedNetworks`. An empty list allows every address. `/ws/agent` then checks both halves of the identity from the query string — the `token` against the stored `authToken` and the `clientId` against the stored one, each mismatch closing with `4001 Unauthorized`. The id is checked as well as the token because a target address pointed at the wrong host would otherwise report that host under somebody else's name.

### 4. Reading keepalived (`src/services/KeepalivedService.ts`)

keepalived has no status API. It writes its state to a file when it receives a signal, and
that is what the agent uses — on a timer (`keepalived.pollInterval`, 5 s by default) and on a
`REQUEST_STATE_UPDATE`. One reading:

1. **Find keepalived.** Every `/proc/<pid>/comm` that reads `keepalived` is a candidate; the
   one whose parent is not a keepalived is the parent process. The agent runs with
   `pid: host`, so this is the host's process table. No process: the reading is
   `running: false`, which is an answer, not an error.
2. **Signal it.** `SIGUSR1` asks for the state dump, `SIGUSR2` for the counters — both at once,
   because keepalived handles them in turn anyway. With `keepalived.jsonSignal` set, that
   signal replaces `SIGUSR1` and the JSON dump is read instead of the text one.
3. **Wait for the file.** A dump counts as written once its modification time is newer than
   before the signal and its size has stopped changing — a read in the middle of the write
   would parse half a dump. `keepalived.dumpTimeoutMs` bounds the wait.
4. **Read it through `/proc/<pid>/root`.** That path is keepalived's own view of the file
   system, so a systemd `PrivateTmp=true` changes nothing and the host's `/tmp` does not have
   to be mounted. It needs `SYS_PTRACE` (and, under AppArmor, an unconfined profile).
5. **Parse it** (`services/parsers/`). The text dump is read line by line as `key = value`
   pairs inside a block, so a key a newer keepalived adds is skipped, not an error. The
   counters become flat snake-case keys (`advertisements_received`, `priority_zero_sent`).
6. **Diff and report** — see below. The reading is stored as `keepalived-last.json`.

A failed reading — no permission to signal, a dump that never came — is `running: true` with
`error` set. The error names the missing capability where it can tell. keepalived's version is
read once per process out of its binary (`/proc/<pid>/exe`), because `keepalived -v` would
have to run the host's binary inside the agent's container.

**What leaves the host.** Instances and sync groups are built field by field from a fixed list:
name, state, configured state, interface, VRID, priority, effective priority, advertisement
interval, virtual addresses, sync group, last transition, and the counters. Nothing is copied
wholesale, so `auth_pass` — which the dump prints — and the rest of the configuration cannot
reach the wire.

**State changes.** The agent compares every reading with the previous one, and with the one on
disk after a restart, so a failover while the agent was down is still reported:

| Kind | Level | When |
| :--- | :---- | :--- |
| `vrrp.state_changed` | `error` to FAULT, `warning` from MASTER, otherwise `info` | An instance's state differs. `occurredAt` is keepalived's own `Last transition`, not the time of the reading. `data` carries `from`, `to` and both priorities. |
| `vrrp.instance_added` / `vrrp.instance_removed` | `info` | An instance appeared or disappeared between two readings of a running keepalived. |
| `keepalived.started` / `keepalived.stopped` | `info` / `warning` | The process appeared or went away. A stop reports no removed instances. |
| `keepalived.unreadable` | `error` | A running keepalived could not be read. Once per streak, not per reading. |

The first reading of a new agent reports nothing: without a previous one there is nothing to
compare, and listing every instance as new would bury the activity list.

### 5. Activity Service (`src/services/ActivityService.ts`)

What the agent has seen, on its way to the server.

- **Events, not sentences.** An event carries a `kind`, a `level`, a subject (instance name,
  VRID, interface) and a `data` object. The wording is written in the dashboard, so an agent of
  an older version keeps reporting usable facts.
- **At-least-once delivery.** The agent gives each event its id and keeps it until the server acknowledges that id with `ACTIVITY_ACK` — not until it has been sent. The queue is offered again on every reconnect, and the id makes a second copy a no-op on the server. A failover while the server is unreachable is therefore on record once it is back. The queue holds at most 500 events; past that the oldest go first.

### 6. Version Detection (`src/core/Version.ts`)### 6. Version Detection (`src/core/Version.ts`)

Resolves the agent version with the following priority:

1. `VERSION` file next to the build output (written by `scripts/generate-version.sh` during `npm run build` and the Docker build). The script takes `APP_VERSION` first, then the version from the root `package.json` (with `+<hash>` when the commit carries no release tag) — see [development.md](development.md#version-injection).
2. Without that file, during development: exact `git tag` on the current commit.
3. Fallback: `{branch}-{short-hash}[-dirty]`.

---

## 🔄 Registration Flow

Registration is a one-time setup step performed via the local web UI:

1. Open `http://localhost:3011` in a browser → redirected to `/register`.
2. Enter the **Server URL** (e.g., `https://manager.example.com`), a **Registration Token** (generated in the server's token management UI) and the **Setup PIN** from the agent's log.
3. The UI checks server reachability (`GET /api/v1/ping`).
4. The agent verifies the setup PIN before it contacts the server, then calls `POST /api/v1/register` with `{token, hostname}`.
5. The server responds with the client's identity: a `clientId` and a permanent `authToken`, both issued by the server.
6. The client saves `clientId`, `authToken` and `serverUrl` to `config.yaml`.
7. The client connects via WebSocket straight away.

### Setup PIN (`src/core/SetupPin.ts`)

`POST /api/register` decides which server the agent obeys from then on — and with it, who
receives what it reports about the host. The endpoint listens on every interface, so it is guarded by
a PIN that is printed to the agent's log once the web server listens:

```
──────────────────────────────────────────────
  Setup PIN:  K7QM-3XRD
  Web UI:     http://<this-host>:3011/register
  The PIN is required to register this agent.
──────────────────────────────────────────────
```

- Read it with `docker logs kasm-client` (or wherever the agent logs to). Case and the hyphen do not matter.
- It is generated at every start and never written to `config.yaml`.
- It stays required after the first registration, because re-registering from the status page is supported. After every successful registration a new PIN is generated and logged, so each PIN works once.
- After 5 wrong attempts the PIN is replaced by a new one (also logged), which ends online guessing without locking the operator out.
- With `enableRegisterPage: false` neither the page nor `POST /api/register` exists, and no PIN is generated.

---

## 🔁 Process Lifecycle (`src/index.ts`)

- **Startup:** starts the local web server if needed and waits for it, then starts reading keepalived, then opens the connection to the server. The readings start **before** the connection on purpose: they belong to the host, not to the link, so an agent that comes up while the server is unreachable still notices a failover and reports it once there is somewhere to report to. A failed `listen()` is logged and the agent continues without its web UI, as before; an unusable `listenPort` ends the start before that, because a silent fallback would put the agent on a port nobody expects.
- **Unhandled promise rejections** are logged at `error` level and the agent keeps running, so it stays connected to the server that monitors this host.
- **Uncaught exceptions** are logged at `fatal` level and the process exits with code 1 after 250 ms (time for the pino transport to flush), to be restarted by the supervisor (`restart: unless-stopped` in `compose.yaml`).
- Both handlers are registered only after startup.
- `SIGINT` / `SIGTERM` stop the web server and exit with code 0.

---

## 🗄️ Data Storage

Identity and connection settings live in `config.yaml`, as they always have. Everything else
the agent has to survive a restart lives in its **data directory** (`src/core/DataStore.ts`):

| File | Owner | Contents |
| :--- | :---- | :------- |
| `keepalived-last.json` | the agent | The last reading, so a restart can still tell what changed while the agent was away. |
| `queue.json`  | the agent  | Activity events the server has not acknowledged yet. |

- **Where it is.** `/app/client/data` in the container, or `<client>/data` beside the source
  outside one; `KASM_CLIENT_DATA_DIR` overrides both. It is deliberately **not** next to
  `config.yaml`: that file is a single-file bind mount, so anything written beside it lives
  in the container's own filesystem and is gone with the next recreate. `compose.yaml`
  mounts a named volume here, and it has to stay one. `KASM_CLIENT_CONFIG` moves
  `config.yaml` itself.
- **Writes are atomic**: a temporary file, then a rename. A host that loses power mid-write
  is exactly the situation this state exists for, and a half-written file is what rename
  cannot leave behind.
- **A damaged file is discarded, not fatal.** An agent that will not start because of its own
  scratch file is the worse failure — the connection an operator would fix it over is the one
  it is refusing to open.
- The activity queue holds at most 500 events and nothing older than seven days; the oldest
  go first. Writes are coalesced over a second, and a `SIGTERM` flushes what is pending before
  the process ends.

There is no local database.

---

## 🔐 Security Notes

- The `authToken` is stored in plain text in `config.yaml`. Secure the file using appropriate filesystem permissions. It is masked in the agent's log.
- The agent needs `pid: host`, `KILL` and `SYS_PTRACE` — see [Agent Permissions](install.md#agent-permissions). It gets no Docker socket and no host file system mount, and it sends keepalived nothing but `SIGUSR1`, `SIGUSR2` and, if configured, the JSON signal. It is nonetheless root on the host in all but name, since `SYS_PTRACE` reaches every host process — see [What These Permissions Amount To](install.md#what-these-permissions-amount-to).
- Registration through the local web UI requires the setup PIN from the agent's log (see [Setup PIN](#setup-pin-srccoresetuppints)). Set `enableRegisterPage: false` once no re-registration is expected.
- The server's TLS certificate is verified for registration and for the WebSocket connection. For a server with a self-signed certificate set `allowSelfSignedCertificates: true`; it then applies to both. The reachability check on the status and register pages always tolerates such a certificate — it sends nothing and only answers whether a KASM server responds. The decision is passed per request (`core/ServerHttp.ts`, the WebSocket options) and never through the process-wide `NODE_TLS_REJECT_UNAUTHORIZED`, which the agent used to set on its first request and never reset.
- Agent connections are validated server-side against `security.allowed_networks` and the client's own allowed address or network, which can be edited or switched off in the client editor.
- `allowedNetworks` in the agent's `config.yaml` restricts where the server may dial `/ws/register` and `/ws/agent` from (empty: no restriction). Refused connections are closed with `4003 Access denied` and logged with the peer address; the local web UI is not restricted.

---

## 📦 Key Dependencies

| Package              | Version | Purpose                          |
| :------------------- | :------ | :------------------------------- |
| `fastify`            | ^5.x    | Local web server                 |
| `@fastify/static`    | ^10.x   | Static file serving              |
| `@fastify/websocket` | ^11.x   | `/ws/register` and `/ws/agent` for outbound mode |
| `ws`                 | ^8.x    | WebSocket client                 |
| `yaml`               | ^2.x    | Config file parsing              |
| `@kasm/shared/node`   | workspace | Pino logger, the same module the server uses (`pino` ^10, `pino-pretty` ^13 are dependencies of `shared`) |
