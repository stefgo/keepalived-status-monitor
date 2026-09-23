# ⚙️ Backend Architecture

This documentation details the architecture of the server backend (`server/backend`), which serves as the control plane for the Keepalived Status Monitor.

## 📂 Project Structure

The backend is built using **Fastify** as the core framework, written in **TypeScript**. It follows a layered architecture: **Routes → Controllers → Services → Repositories**.

```
server/backend/src/
├── config/
│   └── AppConfig.ts                       # Configuration management (JWT, OIDC, settings, security)
├── controllers/                           # HTTP and WebSocket request handlers
│   ├── ActivityController.ts              # Activity list, seen state, deletion
│   ├── AuthController.ts
│   ├── ClientController.ts
│   ├── KeepalivedController.ts            # Readings, clusters, asking an agent to read now
│   ├── SettingsController.ts
│   ├── TokenController.ts
│   ├── UserController.ts
│   ├── WebSocketController.ts
│   └── websocket/
│       ├── AgentMessageRouter.ts          # Dispatch table for messages from authenticated agents
│       ├── AgentSession.ts                # The AUTH handshake and connection lifecycle, both directions
│       └── Heartbeat.ts                   # Shared ping/pong heartbeat for all WebSocket kinds
├── core/                                  # Core infrastructure
│   ├── Database.ts                        # SQLite initialization & migration runner
│   └── migrations/
│       ├── 00_initial.ts                  # users, clients, registration_tokens, activity
│       ├── 01_keepalived_state.ts         # keepalived_state: the last reading per client
│       ├── 02_client_site.ts              # clients.site: part of the VRRP cluster key
│       ├── 03_scheduler_state.ts          # scheduler_state: last run and state per scheduler
│       ├── 04_registration_token_hash.ts  # registration_tokens: store the SHA-256 hash only
│       └── 05_activity_seen.ts            # activity.seen_by -> activity_seen table
├── repositories/                          # Database access layer
│   ├── ActivityRepository.ts              # activity access (insert, dedup, retention)
│   ├── ClientRepository.ts
│   ├── KeepalivedStateRepository.ts       # keepalived_state access
│   ├── SchedulerStateRepository.ts        # scheduler_state access
│   ├── TokenRepository.ts
│   └── UserRepository.ts
├── routes/
│   └── api.ts                             # Fastify route registration (all endpoints)
├── services/                              # Business logic
│   ├── AuthService.ts                     # Authentication, OIDC flow, JWT
│   ├── SessionCookie.ts                   # The httpOnly session cookie and the readable flag beside it
│   ├── ClientConnector.ts                 # Dials an outbound client's agent
│   ├── KeepalivedStateService.ts          # Store readings, broadcast them, build clusters
│   ├── ActivityService.ts                 # Activity ingest, dedup, ack + dashboard broadcast
│   ├── NotificationCleanupService.ts      # Retention cleanup for the activity list
│   ├── ProxyService.ts                    # WebSocket connection management & broadcasting
│   ├── ScheduledJob.ts                    # Timer, run bookkeeping and status of a scheduler
│   ├── SettingsService.ts                 # Settings retrieval, update & persistence
│   └── TokenCleanupService.ts             # Retention cleanup for invalid registration tokens
├── types/
│   └── fastify.d.ts                       # Fastify request/instance augmentations
└── index.ts                               # Fastify server setup & entry point
```

---

## 🏗️ Core Components

### 1. Routes (`src/routes/api.ts`)

All routes are registered as a single Fastify plugin under the `/api` prefix. Protected routes apply `request.jwtVerify()` middleware.

**Public routes:**
- `POST /api/login` — Local authentication; sets the session cookies
- `POST /api/auth/logout` — Clears the session cookies
- `GET /api/auth/config` — Auth type configuration
- `GET /api/auth/login` — OIDC redirect
- `GET /api/auth/callback` — OIDC callback; sets the session cookies and redirects to `/`
- `POST /api/v1/register` — Client self-registration
- `GET /api/health` — Liveness (process + database), used by the container `HEALTHCHECK`
- `GET /api/v1/ping` — Reachability ("is there a KASM server at this URL"), checks nothing on purpose

**Protected routes (JWT required):**
- Session: `GET /api/v1/me` — id, username and expiry of the current session
- Users: `GET/POST /api/v1/users`, `PUT/DELETE /api/v1/users/:userId`
- Clients: `GET /api/v1/clients`, `POST /api/v1/clients/outbound`, `PUT/DELETE /api/v1/clients/:clientId`, `POST /api/v1/clients/:clientId/reconnect`
- Tokens: `GET/POST /api/v1/tokens`, `DELETE /api/v1/tokens/:token`
- keepalived: `GET /api/v1/keepalived/states`, `GET /api/v1/keepalived/clusters`, `GET /api/v1/clients/:clientId/keepalived`, `POST /api/v1/clients/:clientId/keepalived/refresh`
- Settings: `GET/PUT /api/v1/settings/cleanup`, `POST /api/v1/settings/cleanup/{invalid-tokens,notifications}`, `GET /api/v1/settings/scheduler-status`
- Activity: `GET/DELETE /api/v1/activity`, `POST /api/v1/activity/seen`

The full reference is in [api.md](api.md).

**WebSocket routes:**
- `GET /ws/dashboard` — Dashboard real-time feed (JWT from the `kasm_session` cookie)
- `GET /ws/agent` — Client agent connection (clientId + authToken via query params)

### 2. Controllers (`src/controllers/`)

Controllers parse HTTP/WebSocket input, delegate to services, and format responses.

**Input validation.** Every handler that reads a body or a query string runs it through a Zod schema from `@kasm/shared` first and answers `400` with `firstIssue(error)` — the path of the first failing field plus the Zod message — before touching a repository, the config file or an agent:

```ts
const parsed = CreateUserSchema.safeParse(request.body);
if (!parsed.success) {
    return reply.code(400).send({ error: firstIssue(parsed.error) });
}
const { username, password, auth_methods } = parsed.data;
```

`request.body as any` does not appear in the controllers any more. Rules about a combination of fields (a `local` user needs a password, an allowed address only for an inbound client) stay in the controller; the schema describes the shape. `request.user` is typed through `src/types/fastify.d.ts` as `{ username: string; id: number }` — exactly what `jwt.sign` puts into the token.

| Controller              | Responsibilities                                                              |
| :---------------------- | :---------------------------------------------------------------------------- |
| `AuthController`        | Local login, OIDC redirect & callback, PKCE flow management.                 |
| `UserController`        | User CRUD — enforces self-deletion prevention and minimum user count.         |
| `ClientController`      | Client list (with live status and capabilities), adding an outbound client, editing display name, allowed address and target address, deletion (with the client's reading), reconnecting an outbound client. |
| `TokenController`       | Registration token generation, listing, deletion, and client self-registration. |
| `KeepalivedController`  | Every client's last reading, the clusters built from them, one client's reading, asking one agent to read now. |
| `ActivityController`    | The activity list, per-user seen state, deletion of all of it.               |
| `SettingsController`    | Retrieve/update the `settings` block of `config.yaml` (never `security`), trigger manual cleanups. |
| `WebSocketController`   | Dashboard and agent WebSocket lifecycle (auth, heartbeat, message routing).   |

### 3. Services (`src/services/`)

Services contain the business logic shared across controllers.

#### `AuthService`
- `initializeAdmin()` — Creates a default `admin` user (password: `"admin"`) if the database is empty on first startup.
- `checkLocalAuth(username, password)` — Validates credentials against bcrypt-hashed passwords.
- `getAuthConfig()` — Returns local/OIDC configuration for the frontend.
- `generateOidcUrl()` — Builds the OIDC authorization URL with PKCE code challenge and state.
- `handleOidcCallback(currentUrl)` — Validates state, exchanges code for tokens, fetches userinfo.

#### `ProxyService`
The central hub for all real-time communication.

- **Agent tracking**: `registerClient` / `unregisterClient` — manages the map of connected agent WebSockets. A new connection under an id that is already connected replaces the old one, which is closed with `4000 Replaced by new connection`.
- **Capabilities**: `registerClient` also keeps what the agent declared in its `AUTH`. `hasCapability(clientId, capability)` is what server-side decisions ask; `getCapabilities` reports the list onwards (`null` while offline); `getConnectedClientIds` lists who is connected. Capabilities live with the connection, not in the database: they describe the build on the wire.
- **Dashboard tracking**: `addDashboardClient` / `removeDashboardClient` — manages all active dashboard sessions, each with the id of the user whose session cookie opened it.
- **Status enrichment**: `getClientsWithStatus()` — augments database records with live online/offline status.
- **Broadcasting**: `broadcastClientUpdate()` sends `CLIENTS_UPDATE` to all dashboards; `broadcastToDashboard()` multicasts arbitrary messages; `sendToUser()` sends to the sessions of one user only.
- **Fire-and-forget**: `sendFireAndForget(clientId, type, payload)` — one-way message to an agent.
- **Fire-and-forget** is the only direction the server needs: `REQUEST_STATE_UPDATE` asks an agent to read now, and what comes back is an ordinary `KEEPALIVED_UPDATE`.

#### `ClientConnector`
The server's side of **outbound** clients, the ones the server dials.

- `connectAll()` — At startup, after `listen()`: dials every stored outbound client that has an auth token. One without a token cannot be retried here, because registering needs the agent's setup PIN (or secret) from the dashboard.
- `firstConnect(id, address, secret, onPersist)` — Adding a client: registers on the agent's `/ws/register` (handing over the setup PIN or secret, a fresh auth token and the server-issued id), then opens `/ws/agent`. `onPersist` writes the client only once `AUTH` has succeeded; on failure nothing is stored and the reason from the handshake is returned.
- `connectClient(client)` — A regular session on `<scheme>://<outboundTargetAddress>/ws/agent?clientId=…&token=…`, with a 10-second connect timeout. The scheme comes from the stored address: an address written `wss://host:port` is dialled over TLS, a bare `host:port` over plaintext. One helper decides scheme and certificate handling for all three dial sites, so the query — which carries the auth token — is also what keeps it out of the log line. After an open socket the session is handed to `WebSocketController.handleOutboundAgentConnection`.
- `scheduleReconnect(clientId)` — Reconnects after 5, 10, 30 and then every 60 seconds, the same delays the agent uses for inbound connections. The ladder restarts once a socket opens.
- `disconnectClient(clientId)` — Cancels a pending reconnect and resets the ladder; used before deleting, reconnecting or re-addressing a client.

#### `KeepalivedStateService`
- `handleUpdate(clientId, payload)` — One `KEEPALIVED_UPDATE`: parsed against `KeepalivedStatusSchema` (loose, so an agent that reports more is never dropped; an unknown state word becomes `UNKNOWN`), stored as the client's reading in `keepalived_state`, and broadcast as `KEEPALIVED_STATE_UPDATE` with `clientId` and `receivedAt`. A malformed reading is logged with the client id and the field and discarded; the last good one stays stored.
- `getAll()` / `getByClientId(clientId)` — The stored readings, parsed again on the way out so a row an older build wrote cannot reach the dashboard in a shape it does not expect.
- `getClusters()` — `buildVrrpClusters` from `@kasm/shared` over every reading, the ids `ProxyService` has connected and the `site` of every client, which is part of the cluster key (`<site>|<vrid>|<network>` — the
virtual addresses are payload, not identity). The dashboard runs the same function over what it was pushed, so the endpoint and the page cannot disagree.
- `delete(clientId)` — With the client.
- **No failover logic here.** The agent compares its readings itself and reports every change as an activity event, with keepalived's own transition time. That keeps a failover during a server outage on record, which a server-side diff between two readings could not.

#### `ActivityService`
Activity events are structured facts — `kind`, `level`, a subject, a `data` object — recorded by whoever observed them. Nothing in the backend writes a sentence: the text is composed in the frontend out of `kind` and `data`, so an agent of an older version stays useful and filtering by kind and level is exact rather than a search through prose.

- `list()` — Every event, newest first by `occurred_at`.
- `record(input)` — Records an event the **server** is the originator of. That is deliberately a short list: the connection state of an agent (`client.connected` / `client.disconnected`), a registration (`client.registered`), and a scheduler run that threw (`scheduler.failed`, `error`, with `scheduler`, `trigger` and `error`). Everything that happens *on* a host is reported by that host.
- `handleBatch(clientId, payload)` — One `ACTIVITY` batch from an agent: validated, ingested, then acknowledged with `ACTIVITY_ACK`. Only the envelope is parsed as a whole; the events are parsed one by one. A batch whose envelope does not parse is dropped **without** an ack, so the agent keeps offering it — acknowledging what was never written would delete it on the only side that still had it. The one exception is an event that can never be stored: one that does not parse but carries an id is acknowledged without being stored and logged, because re-offering it changes nothing and the agent's in-order queue would stall behind it until its seven-day age limit.
- `ingest(clientId, events)` — Stores the batch and returns the ids the agent may drop. `source` and `clientId` are overwritten from the connection: an agent may only ever speak about itself.
- `markManySeen` / `deleteAll` — Each broadcasts the new list as `ACTIVITY_UPDATE`; `markManySeen` only when it changed anything.

Delivery is at-least-once and the id comes from the originator, so a repeat is expected rather than an error: `ActivityRepository.insertMany` writes `ON CONFLICT DO NOTHING` inside one transaction, and the second copy of an event changes nothing. That is what puts a failover at three in the morning, with the server switched off, on record once the server is back.

#### `ScheduledJob`
The timer, the bookkeeping and the status of one server scheduler; both — `NotificationCleanupService` and `TokenCleanupService` — hold one and differ only in the work they do.
- `run(trigger, work)` — Runs `work` as one recorded run (`trigger` is `schedule` or `manual`): `SchedulerStateRepository.markStarted` before, `markFinished` after, with `success` (or `partial` where a scheduler says so; none does today). A run that throws is stored as `failed` with its message, recorded as `scheduler.failed` in the activity, and the exception is rethrown. Broadcasts `SCHEDULER_STATUS_UPDATE` when a run starts and when it ends.
- `start(runScheduled)` / `stop()` — The timer is a chain of timeouts rather than an interval. The first run comes one interval after the last run *started* — at once if that is already past — so a restart does not push a due run back by a whole interval; without a stored run it comes one interval after startup. An interval of `0` switches the timer off. Delays beyond what `setTimeout` takes (~24 days) are waited out in steps.
- `status()` — `{ isRunning, nextRun, lastRun }`, `lastRun` read from `scheduler_state`.

Each service's `run(trigger = "schedule")` goes through its job; the settings controller passes `"manual"`. `startScheduler()` / `stopScheduler()` / `restartScheduler()` and `getStatus()` delegate to it. At startup, `index.ts` calls `SchedulerStateRepository.markInterrupted()` before starting either of them.

#### `NotificationCleanupService`
Retention for the activity list. It is named after the settings it reads (`notification_retention_days`, `notification_retention_count`, `notification_cleanup_interval_hours`) and the page they are set on, "Notification History". Age is the event's own `occurred_at`, not its arrival time: a batch handed over after a week offline is a week old. Runs every `notification_cleanup_interval_hours`; returns `{ removed }`.

#### `TokenCleanupService`
- `run(trigger?)` — Removes registration tokens that have been invalid (used or expired) for longer than `token_retention_days`. Returns `{ removed }`.
- `startScheduler()` / `stopScheduler()` / `restartScheduler()` — Runs every `token_cleanup_interval_hours` (default `24`); `0` disables the scheduler. Restarted when `token_retention_days` or `token_cleanup_interval_hours` changes.

#### `SettingsService`
Reads and writes the `settings` block of `config.yaml` and nothing else — `security`, `jwtSecret` and the OIDC credentials are startup configuration without an API.
- `getAllSettings()` — The `settings` block, every default filled in.
- `getSetting(key)` — One value as a string, or `null` when empty or not a scalar.
- `updateSettings(settings)` — Merges already validated keys into the block and writes the file. Then restarts the activity cleanup or the token cleanup when one of its keys changed.

### 4. Repositories (`src/repositories/`)

Repositories encapsulate all database queries using `better-sqlite3` (synchronous).

| Repository               | Tables accessed                          | Key operations                                                   |
| :----------------------- | :--------------------------------------- | :--------------------------------------------------------------- |
| `ClientRepository`       | `clients`                                | Create inbound/outbound, lookup by id and token as a pair (`findByIdAndToken`), update display name, addresses, auth token, last_seen/version. |
| `TokenRepository`        | `registration_tokens`                    | Create with expiry and optional defaults, find a valid one, mark as used, delete, retention cleanup. |
| `UserRepository`         | `users`                                  | CRUD, lookup by username, password hash management.              |
| `KeepalivedStateRepository` | `keepalived_state`                    | Upsert, list and delete the last reading per client.             |
| `ActivityRepository`     | `activity`, `activity_seen`              | Batch insert with primary-key dedup, seen state, deletion, retention. |
| `SchedulerStateRepository` | `scheduler_state`                      | Mark a run started and finished, save and read the state a scheduler carries, turn runs cut off by a restart into `interrupted` ones. |

### 5. WebSocket Controller (`src/controllers/WebSocketController.ts`)

**Dashboard WebSocket (`/ws/dashboard`):**
- Verifies the JWT from the `kasm_session` cookie of the handshake (`4001` without or with an invalid one).
- Sends on connect: `CLIENTS_UPDATE`, the stored `KEEPALIVED_STATE_UPDATE` of every client, and `ACTIVITY_UPDATE`.
- Attaches the 30-second ping/pong heartbeat before the JWT check.
- Registered in `ProxyService` to receive all broadcasts.

**Heartbeat (`src/controllers/websocket/Heartbeat.ts`):** all three connection kinds —
dashboard, inbound agent, outbound agent — use `attachHeartbeat(socket, onTimeout?)`: a ping
every 30 seconds, `terminate()` when the previous pong never arrived. It registers its own
`close` handler, so a socket closed during authentication cannot leave the interval running.

**Agent session (`src/controllers/websocket/AgentSession.ts`):** `attachAgentSession()` runs
an agent connection from the `AUTH` handshake to the close, and both connection kinds go
through it. Each used to carry its own copy: the same timeout, the same Zod check, the same
register/record/broadcast sequence and the same close block. That copy spanned the point
where a client is marked online, so a difference between the two would have shown up as a
host that is connected on one route and not on the other. What genuinely differs is a
parameter — `ip` is stored and recorded inbound but `null` and omitted outbound,
`onAuthenticated` is the hook the outbound path creates a new client from, and
`onAuthFailed` carries the reason, so the inbound route still answers `AUTH_FAILURE` only
for a first message that is not `AUTH`. The heartbeat stays outside: the inbound route
attaches it before its credential checks, so a rejected connection loses its ping timer too.

**Agent WebSocket (`/ws/agent`):**
- Authentication: id + token resolved as a pair (`findByIdAndToken`; either half missing is `4001`) → `security.allowed_networks` → outbound clients refused → per-client allowed address (skipped when switched off) → 5-second AUTH handshake.
- On success: updates `last_seen`, `version` and (inbound only) `inbound_last_ip` in the database; registers in `ProxyService` with the declared capabilities; answers `AUTH_SUCCESS`; broadcasts `CLIENTS_UPDATE` to all dashboards. The agent then pushes a fresh `KEEPALIVED_UPDATE` of its own.
- Outbound agents enter through `handleOutboundAgentConnection` over the socket `ClientConnector` opened, and from the handshake on run the same session as an inbound one. That path adds two things of its own: the first `AUTH` persists a newly added client, and a close schedules the reconnect.
- Incoming messages go through `routeAgentMessage()` (see below): `KEEPALIVED_UPDATE` → `KeepalivedStateService.handleUpdate()` (validate, persist, rebroadcast), `ACTIVITY` → `ActivityService.handleBatch()` (store, broadcast, `ACTIVITY_ACK`).
- Connecting, disconnecting and registering are recorded as `client.connected`, `client.disconnected` and `client.registered`. They are the events only the server can observe — an agent cannot report that it is unreachable.
- `client.connected` and `client.disconnected` are recorded at level `trace`, because they happen routinely. Both carry `clientName` in `data` — the display name, else the hostname — so the line names its host even after the host has been renamed or removed.
- On disconnect: unregisters from `ProxyService`; broadcasts updated client list.

**Message routing (`src/controllers/websocket/AgentMessageRouter.ts`):** what an
authenticated agent may send is one `type → handler` table, and both connection kinds
dispatch through it. The two branches used to stand once per kind although the messages are
identical in either direction, so a third type would have had to be added twice. An unknown
type is logged at debug and dropped — an agent of a newer build may know messages this
server does not.

The handshake is deliberately not in the table. `AUTH` is not something an authenticated
agent sends, and each connection kind ties its own side effects to it (clearing a timeout,
persisting a new client, resolving the caller's promise), which a table entry cannot carry.

---

## 🔁 Process Lifecycle (`src/index.ts`)

- **Startup is fail-fast.** Database migrations, OIDC discovery, the admin bootstrap, `listen()` on the configured port (`3010` by default) and the initial outbound connections run first; any error there logs and exits with code 1.
- **Unhandled promise rejections** are logged at `error` level and the process keeps running. A stray rejection must not drop every agent and dashboard connection.
- **Uncaught exceptions** are logged at `fatal` level, the schedulers are stopped, and the process exits with code 1 after 250 ms (time for the pino transport to flush). The container supervisor restarts it (`restart: unless-stopped` in `compose.yaml`).
- Both handlers are registered only after startup completed, so they never hide a failed start.
- `SIGINT` / `SIGTERM` stop the schedulers and close the server gracefully (exit code 0).

---

## 📝 Logging

The logger lives in `shared/src/node/logger.ts` and is imported as `@kasm/shared/node` — by the backend and the client agent alike. The same `loggerOptions` object is handed to Fastify, so application lines and request logs share one format and one `pino` instance. The backend used to carry its own copy on `pino@9` while Fastify resolved `pino@10`: two majors of the same library in one process.

- `LOG_FORMAT=json` forces JSON, `LOG_FORMAT=pretty` forces `pino-pretty`; without it, `NODE_ENV=production` means JSON and anything else pretty.
- `LOG_LEVEL` sets the level; `logLevel` in `config.yaml` applies when the variable is unset.
- `@kasm/shared/node` is a separate entry point on purpose. The frontend imports `@kasm/shared`, and anything Node-only exported from the main index would end up in the browser bundle. What needs Node goes behind `/node`; pure types, schemas and constants stay in the main index.
- `pino-pretty` is loaded by name inside pino's transport worker, not imported, so it has to stay a dependency of `shared` even though no file references it.

---

## 🗄️ Database Management

The backend uses **SQLite3** via `better-sqlite3` (synchronous API) for fast, embedded storage.

- **Location**: `server/backend/data/server.db` (created automatically on first run) — `/app/server/backend/data` in the image, which `compose.yaml` mounts as the `server-data` volume.
- **WAL mode**: Enabled for improved read/write concurrency.
- **Migrations**: Managed by `umzug`. All pending migrations are applied automatically on startup.

### Schema

**`clients`**

| Column        | Type     | Description                                              |
| :------------ | :------- | :------------------------------------------------------- |
| `id`          | TEXT PK  | Client UUID, issued by the server at registration.       |
| `hostname`    | TEXT     | Client hostname.                                         |
| `display_name`| TEXT     | Optional human-readable name.                            |
| `auth_token`  | TEXT     | Permanent token for WebSocket authentication (unique).   |
| `connection_mode` | TEXT | `inbound` (default) or `outbound`.                        |
| `inbound_allowed_ip` | TEXT | Inbound: the address or IPv4 network connections must come from. `NULL` switches the check off. |
| `inbound_last_ip` | TEXT | Inbound: the address of the last successful authentication. Written only after the allowed-address check passed. |
| `outbound_target_address` | TEXT | Outbound: `host:port` the server dials. |
| `version`     | TEXT     | Agent version reported on last connection.               |
| `last_seen`   | DATETIME | Timestamp of last successful connection.                 |
| `created_at`  | DATETIME | Creation timestamp.                                      |
| `updated_at`  | DATETIME | Last update timestamp.                                   |

> KASM started from docker-instance-manager, whose migrations 00–16 are folded into `00_initial` here — without the Docker tables and columns, and without their history.

**`users`**

| Column          | Type        | Description                                          |
| :-------------- | :---------- | :--------------------------------------------------- |
| `id`            | INTEGER PK  | Auto-incremented user ID.                            |
| `username`      | TEXT UNIQUE | Unique username.                                     |
| `password_hash` | TEXT        | bcrypt-hashed password (null for OIDC-only users).   |
| `auth_methods`  | TEXT        | Comma-separated: `"local"`, `"oidc"`, or both.       |
| `created_at`    | DATETIME    | Creation timestamp.                                  |
| `updated_at`    | DATETIME    | Last update timestamp.                               |

**`registration_tokens`**

| Column       | Type     | Description                                              |
| :----------- | :------- | :------------------------------------------------------- |
| `token_hash` | TEXT PK  | SHA-256 (hex) of the random 32-character token. The token itself is only in the response that issued it _(migration 04)_. |
| `created_at` | DATETIME | Creation timestamp.                                      |
| `expires_at` | DATETIME | Expiry timestamp (30 minutes after creation).            |
| `used_at`    | DATETIME | Timestamp when a client registered with this token.      |
| `display_name` | TEXT   | Name the client is created under. `NULL`: the agent's hostname. |
| `allowed_ip` | TEXT     | Allowed address or network for the client. `NULL`: the address it registers from. |

**`keepalived_state`** _(migration 01)_

| Column        | Type    | Description                                                              |
| :------------ | :------ | :----------------------------------------------------------------------- |
| `client_id`   | TEXT PK | FK → `clients(id)`, cascades on delete. No `PRAGMA` is needed: better-sqlite3 is built with `SQLITE_DEFAULT_FOREIGN_KEYS=1`; `ClientController.delete` removes the row explicitly as well. |
| `status`      | TEXT    | JSON: the agent's last `KEEPALIVED_UPDATE` as it passed `KeepalivedStatusSchema`. |
| `received_at` | TEXT    | ISO timestamp the server received it.                                    |

One row per client, overwritten by every reading: the history of state changes is the
activity list, reported by the agents themselves.

**`activity`** _(migration 00)_

| Column           | Type    | Description                                                                            |
| :--------------- | :------ | :------------------------------------------------------------------------------------- |
| `id`             | TEXT PK | Given by the originator. Delivery is at-least-once; the key is what makes a repeat a no-op. |
| `source`         | TEXT    | `agent` or `server`.                                                                   |
| `client_id`      | TEXT    | Whose host this is about. `NULL` for events about nothing in particular.               |
| `kind`           | TEXT    | e.g. `vrrp.state_changed`. Not constrained to the kinds this build knows.              |
| `level`          | TEXT    | `trace`, `info`, `warning` or `error`. `trace` is routine bookkeeping the dashboard hides by default. |
| `correlation_id` | TEXT    | Groups events that belong together, entered by whoever caused them.                    |
| `subject`        | TEXT    | JSON: VRRP instance name, VRID, interface.                                             |
| `data`           | TEXT    | JSON: the facts of this kind — the old and the new state, priorities, an error.        |
| `occurred_at`    | TEXT    | The originator's clock. Orders the list.                                               |
| `received_at`    | TEXT    | The server's clock. Tells a late arrival from a recent event, and exposes a wrong agent clock. |

Indexed on `occurred_at DESC` and on `correlation_id`. There is no message column: the text
is written in the frontend out of `kind` and `data`.

**`activity_seen`** _(migration 05)_

| Column        | Type       | Description                           |
| :------------ | :--------- | :------------------------------------ |
| `activity_id` | TEXT FK    | → `activity.id`, `ON DELETE CASCADE`. |
| `user_id`     | INTEGER FK | → `users.id`, `ON DELETE CASCADE`.    |

Primary key `(activity_id, user_id)`, `WITHOUT ROWID`. One row per event a user has seen, so
marking is a single `INSERT OR IGNORE`, and retention, "Delete all" and deleting a user clear
it away by themselves. Until migration 05 this was a JSON array in `activity.seen_by`; its
entries were moved over, except the ids of users that no longer exist.

**`scheduler_state`** _(migration 03)_

One row per scheduler, written over on every run — there is no history. What is worth looking back on, a run that failed or was cut short, is in the activity list.

| Column             | Type    | Description                                                                          |
| :----------------- | :------ | :----------------------------------------------------------------------------------- |
| `scheduler`        | TEXT PK | `notification-cleanup`, `token-cleanup`.                                             |
| `running_since`    | TEXT    | Start of the run in progress; NULL when none runs.                                   |
| `running_trigger`  | TEXT    | `schedule` or `manual`, for the run in progress.                                     |
| `last_started_at`  | TEXT    | Start of the last finished run.                                                      |
| `last_finished_at` | TEXT    | Its end; NULL for an `interrupted` run.                                              |
| `last_trigger`     | TEXT    | `schedule` or `manual`.                                                              |
| `last_status`      | TEXT    | `success`, `partial`, `failed` or `interrupted`.                                     |
| `last_result`      | TEXT    | JSON, `{ removed }` for both schedulers.                                             |
| `last_error`       | TEXT    | The message of a `failed` or `interrupted` run.                                      |
| `state`            | TEXT    | JSON a scheduler carries from one run to the next; none uses it today.              |

> The running columns are kept apart from the `last_*` ones so the page goes on showing the last finished run while a run is in progress. A row that still has `running_since` at startup belongs to a run the server did not live to finish; `markInterrupted` turns it into the last run, `interrupted`.

---

## 🔐 Authentication Flow

- **Local Login**: Username/password validated against bcrypt hashes in SQLite. On success the JWT is set as the httpOnly cookie `kasm_session`, next to a readable flag cookie `kasm_auth` without a secret (`services/SessionCookie.ts`). Both are `SameSite=Strict`, `Secure` when the request came in over HTTPS, and expire with the token. The token is never part of a response body or a URL.
- **Session transport**: `@fastify/cookie` parses the cookie, and `@fastify/jwt` is registered with `cookie: { cookieName: "kasm_session" }`, so `request.jwtVerify()` accepts the cookie as well as an `Authorization: Bearer` header. The dashboard WebSocket reads the same cookie from the handshake.
- **OIDC Login**: Full PKCE flow — the backend generates the authorization URL, handles the callback, exchanges the code for tokens, fetches userinfo from the provider, and issues a local JWT in the same cookies as the local login before redirecting to `/`.
- **Agent Auth**: Agents connect via WebSocket using a permanent `authToken` (obtained during registration). The token is validated against the database and the source IP is checked against configured network rules.
- **First Run**: If no users exist, `AuthService.initializeAdmin()` creates an `admin` user with the default password `"admin"`. **This should be changed immediately after first login.**

---

## ⚙️ Configuration (`src/config/AppConfig.ts`)

The backend reads its configuration from `server/config.yaml` (and environment variables). The config is loaded at startup and written back when settings are updated via the API.

**Validated at startup.** After a missing `jwtSecret` has been generated, the whole file is checked against `AppConfigSchema` from `@kasm/shared`, which also holds every default. An invalid value ends the start with exit code 1 and one fatal log line naming the field, for example:

```
Invalid config.yaml -- security.allowed_networks.0: Must be an IPv4 address or an IPv4 network in CIDR notation
```

Checked are types and value ranges: whole numbers and `true`/`false` in `settings` (as string or as plain YAML value), IPv4 addresses or networks in the `security` lists, `hsts` as a boolean, `logLevel` as a pino level, and — only while `oidc.enabled` is `true` — the OIDC URLs and credentials. The top level and `settings` stay loose: keys the schema does not know are kept, because the file is written back and would otherwise lose them. Defaults are written into the file only when a known `settings` key was missing, as before; a valid file is not rewritten on startup.

**Key configuration sections:**

| Section             | Description                                                       |
| :------------------ | :---------------------------------------------------------------- |
| `jwtSecret`         | Auto-generated on first run if not present.                       |
| `jwtExpiresIn`      | JWT session lifetime (e.g. `"24h"`). Defaults to `"12h"`; tokens always expire. Also enforced as `maxAge` on verification, so tokens issued without an expiry are retired by age. |
| `oidc`              | OIDC provider settings (`enabled`, `issuer`, `client_id`, etc.).  |
| `logLevel`          | pino level; `LOG_LEVEL` wins when set.                            |
| `settings`          | Operator settings (stored as strings, defaults in `AppSettingsSchema`): `token_*`, `notification_*`. See [Get Settings](api.md#get-settings). |
| `security.allowed_networks`  | IPv4 addresses or CIDR ranges permitted to connect as agents. The per-client address lives in `clients.inbound_allowed_ip`, editable via `PUT /clients/:id`; network matching is `@kasm/shared`'s `network.ts`, shared with the agent and the client editor. |
| `security.hsts`              | Send `Strict-Transport-Security` (default `false`). Read at startup. |

---

## 📦 Key Dependencies

| Package                | Version   | Purpose                          |
| :--------------------- | :-------- | :------------------------------- |
| `fastify`              | ^5.x      | HTTP framework                   |
| `@fastify/websocket`   | ^11.x     | WebSocket support                |
| `@fastify/jwt`         | ^10.x     | JWT middleware                   |
| `@fastify/cookie`      | ^11.x     | Session cookie parsing           |
| `@fastify/cors`        | ^11.x     | Registered with `origin: false` — no CORS headers (same-origin only) |
| `@fastify/static`      | ^10.x     | Frontend static file serving     |
| `@fastify/rate-limit`  | ^11.x     | Login rate limit (10 attempts / 15 min, no global limit) |
| `@fastify/helmet`      | ^13.x     | Security headers incl. Content-Security-Policy; HSTS only with `security.hsts` |
| `better-sqlite3`       | ^13.x     | Synchronous SQLite3              |
| `umzug`                | ^3.x      | Database migration management    |
| `bcryptjs`             | ^3.x      | Password hashing                 |
| `openid-client`        | ^6.x      | OIDC / PKCE client               |
| `yaml`                 | ^2.x      | Config file parsing              |
| `@kasm/shared/node`     | workspace | Pino logger (`logger`, `loggerOptions`), shared with the agent — see [Logging](#-logging) |
| `@kasm/shared`          | workspace | Types, Zod schemas and `buildVrrpClusters`, shared with the agent and the dashboard |
