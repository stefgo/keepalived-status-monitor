# Installation & Setup

## Prerequisites

- **Node.js**: v22.x or higher
- **npm**: v10.x or higher
- **Docker** & **Docker Compose** (optional, for container-based setup)
- **keepalived** on the hosts to be monitored — any 2.x release. The agent reads it through
  its state dump; nothing has to be enabled in keepalived for that.

## Project Structure

The project is organized as a monorepo with npm workspaces:

| Workspace          | Description                                      |
| :----------------- | :----------------------------------------------- |
| `shared`           | Shared types, schemas (Zod), and constants.       |
| `client`           | The monitoring agent (Node.js/TypeScript).        |
| `server/backend`   | The API and WebSocket server (Fastify).           |
| `server/frontend`  | The web dashboard (React/Vite).                  |

## Installation (Local)

1. **Clone the repository:**

    ```bash
    git clone <repo-url>
    cd keepalived-status-monitor
    ```

2. **Install all dependencies:**
    Run this command in the root directory to install all workspace dependencies at once:

    ```bash
    npm install
    ```

3. **Build the shared library:**
    The `shared` package must be built before any other workspace can start:

    ```bash
    npm run build -w shared
    ```

## Starting (Development)

### Variant A: Local (without Docker)

**Start the backend server:**

```bash
npm run dev:server
```

_The server API runs on `http://localhost:3010` by default._

**Start the frontend dev server** (optional, for hot-reloading):

```bash
npm run dev:frontend
```

**Start the client agent:**

```bash
npm run dev:client
```

_The client's local web UI runs on `http://localhost:3011` unless `listenPort` or `KASM_CLIENT_PORT` moves it._

Without keepalived on the machine the agent reports it as not running. For something to
look at, use variant B.

### Variant B: Docker Compose

A complete, isolated development environment with two keepalived nodes:

```bash
NPM_TOKEN=$(gh auth token) docker compose -f compose.dev.yaml up -d --build
```

| Service        | Port   | Description                          |
| :------------- | :----- | :----------------------------------- |
| `server-dev`   | `3010` | Backend in watch mode; serves the built frontend (run `npm run build -w server/frontend` first). |
| `keepalived-a` | —      | keepalived node A: MASTER of VRID 51, BACKUP of VRID 52. |
| `keepalived-b` | —      | keepalived node B: the other way round. |
| `client-a`     | `3011` | Agent next to node A (watch mode), in its PID and network namespace. |
| `client-b`     | `3012` | Agent next to node B.                |

Register both agents through their web UIs with the server URL `http://172.28.0.10:3010`.
`docker exec kasm-keepalived-a sh -c 'echo 1 > /tmp/kasm-fault'` puts node A into FAULT,
`echo 0` brings it back — a failover in both directions. Both agents poll; node A also reports
changes through its notify FIFO and node B through the notify script, so both
[triggers](#faster-failover-detection) show up in the agents' debug logs.

View logs:

```bash
docker compose -f compose.dev.yaml logs -f
```

## Container Images

The server and the agent are published as multi-arch images (`linux/amd64`, `linux/arm64`):
`ghcr.io/stefgo/kasm-server` and `ghcr.io/stefgo/kasm-client`.

| Tag | What it is |
| :-- | :--------- |
| `latest` | The last release. Moves only when a release is published. **Use this one** unless you have a reason not to. |
| `1.2.0` | A specific release. Pin it to make an upgrade a decision rather than a side effect of `docker compose pull`. |
| `1.2` | The newest patch release of that minor version. |
| `main` | The current state of the `main` branch — not a release, and it can be ahead of `latest`. |
| `dev` | The state of development. Expect it to break. |
| `sha-<short>` | The build of one commit on `main` or `dev`. |

An image is tagged only after CI has started it and it answered its health check.

## Configuration

### Environment Variables

| Variable      | Values                           | Default       | Description                                                                   |
| :------------ | :------------------------------- | :------------ | :---------------------------------------------------------------------------- |
| `LOG_LEVEL`   | `trace`, `debug`, `info`, `warn`, `error`, `fatal`, `silent` | `info` | Controls log verbosity. Wins over `logLevel` in `config.yaml`. |
| `LOG_FORMAT`  | `pretty`, `json`                 | _auto_        | `pretty` for colored single-line logs (default in dev), `json` for prod.      |
| `KASM_SERVER_PORT` | `1`–`65535`                 | `3010`        | Port the server listens on; wins over `port` in `config.yaml`. An unusable value ends the start. The container's health check reads it too. |
| `NODE_ENV`    | `development`, `production`      | `development` | Picks the log format when `LOG_FORMAT` is unset (`production` → JSON).        |
| `KASM_CLIENT_PORT` | `1`–`65535`                  | `3011`        | _(Client only)_ Port of the local web server; wins over `listenPort` in `config.yaml`. An unusable value ends the start. |
| `KASM_CLIENT_DATA_DIR` | path                     | `/app/client/data` | _(Client only)_ Where the agent keeps its own state: its last keepalived reading and unacknowledged activity events. Set it when the agent runs outside the shipped `compose.yaml`. |
| `KASM_CLIENT_CONFIG` | path                       | `/app/client/config.yaml` | _(Client only)_ The agent's `config.yaml`. Lets several agents run from one checkout, as in `compose.dev.yaml`. |
| `KASM_PROC_DIR` | path                              | `/proc`       | _(Client only)_ Where the agent looks for keepalived's process. Only for tests against a copied process tree. |
| `KASM_NOTIFY_FIFO` | path                           | _unset_       | _(Client only)_ keepalived's `vrrp_notify_fifo`; wins over `keepalived.notifyFifo`. See [Faster Failover Detection](#faster-failover-detection). |
| `KASM_NOTIFY_TOKEN` | string, ≥ 16 characters       | _unset_       | _(Client only)_ Token of the notify endpoint; wins over `keepalived.notifyToken`. See [Faster Failover Detection](#faster-failover-detection). |

**Example:**

```bash
LOG_LEVEL=debug LOG_FORMAT=json npm run dev -w server/backend
```

### Configuration Files (`config.yaml`)

#### Client Config (`client/config.yaml`)

Created automatically during registration, or can be set up manually using `client/config.example.yaml` as a template.

| Key          | Description                                                                    |
| :----------- | :----------------------------------------------------------------------------- |
| `clientId`   | UUID of this client, issued by the server at registration. Leave empty.        |
| `logLevel`   | Log verbosity for the client agent.                                            |
| `serverUrl`  | HTTP(S) URL of the management server (e.g., `https://manager.example.com`).   |
| `authToken`  | Permanent authentication token. Populated automatically after registration.    |
| `registrationSecret` | Outbound mode: the secret the server presents when it first dials the agent. Enter the same value in the **Add Client** wizard; it is removed from the file after registration. |
| `keepalived.pollInterval` | Seconds between two readings (default `5`); `0` switches the timer off, which needs one of the two below. |
| `keepalived.notifyFifo` | keepalived's `vrrp_notify_fifo` as keepalived sees the path; every line in it triggers a reading. Unset by default. See [Faster Failover Detection](#faster-failover-detection). |
| `keepalived.notifyToken` | Token for `POST /api/keepalived/notify`, which a keepalived notify script calls; at least 16 characters. Unset by default: the endpoint does not exist. |
| `keepalived.dataFile` / `statsFile` / `jsonFile` | Where keepalived writes its dumps, as keepalived sees the path (defaults `/tmp/keepalived.data`, `.stats`, `.json`). Match `state_dump_file`, `stats_dump_file` and `json_dump_file` if `keepalived.conf` sets them. |
| `keepalived.jsonSignal` | Read the JSON dump instead of the text dump: the number `keepalived --signum=JSON` prints on the host. Only for a keepalived built with `--enable-json`. Unset by default. |
| `keepalived.dumpTimeoutMs` | How long to wait for keepalived to write a dump (default `3000`). |
| `listenPort` | Port of the local web server (default `3011`); `KASM_CLIENT_PORT` wins over it. |
| `enableStatusPage` / `enableRegisterPage` | Serve the status page and the registration page with `POST /api/register` (both default `true`). |
| `allowSelfSignedCertificates` | Accept a server certificate that does not validate (self-signed), for registration and the WebSocket connection. Default `false`. |
| `allowedNetworks` | IPv4 addresses or CIDR networks the **server** may dial this agent from, checked on `/ws/register` and `/ws/agent`. Empty (default) allows every address. The local web UI is not restricted by it. An invalid entry stops the agent with a log line naming it. |

#### Server Config (`server/config.yaml`)

Created automatically on first start. Contains advanced settings for authentication and security.

The server checks the file on every start. A value of the wrong type or format — `hsts: "yes"`, an invalid CIDR, `oidc.enabled: true` without an `issuer` — stops the start with exit code 1 and a log line that names the field:

```
Invalid config.yaml -- security.hsts: Invalid input: expected boolean, received string
```

Fix the value and start again. Unknown keys are kept and do not cause an error.

| Key                        | Sub-Key         | Description                                              |
| :------------------------- | :-------------- | :------------------------------------------------------- |
| `jwtSecret`                | —               | JWT signing secret. Auto-generated on first run.         |
| `oidc`                     | `enabled`       | Enables or disables OIDC login (`true`/`false`).         |
|                            | `issuer`        | OIDC Issuer URL.                                         |
|                            | `client_id`     | OIDC Client ID.                                          |
|                            | `client_secret` | OIDC Client Secret.                                      |
|                            | `redirect_uri`  | OIDC Redirect URI.                                       |
| `jwtExpiresIn`             | —               | JWT session lifetime (e.g. `"24h"`). Defaults to `"12h"`. Tokens always expire; the session cookies expire with them, and the dashboard logs out when they do. |
| `settings`                 | `retention_invalid_tokens_days` / `_count` | Retention policy for used/expired registration tokens. |
|                            | `notification_retention_days` / `_count` / `notification_cleanup_interval_hours` | Retention of the activity list (defaults 90 days, at least 500 kept, every 24 h). |
| `logLevel`                 | —               | pino log level; `LOG_LEVEL` wins when set.               |
| `port`                     | —               | Listen port (default `3010`); `KASM_SERVER_PORT` wins when set. The published port: `EXPOSE`, the compose port mapping and every agent's `serverUrl` have to follow it. |
| `security`                 | `allowed_networks` | IPv4 addresses or CIDR networks an agent may open `/ws/agent` from, for all agents alike. Empty (default) allows every address. |
|                            | `hsts`          | Send `Strict-Transport-Security` (default `false`). Enable only when the dashboard is served exclusively over HTTPS — browsers remember the header for months. Requires a restart. |

## First Login

On the first start, if no users exist in the database, the backend automatically creates an `admin` user with the password `admin`.

> **Change this password immediately after first login** via the user management UI or the `PUT /api/v1/users/:userId` endpoint.
> The server logs a warning on startup when it creates this account.

`POST /api/login` accepts at most 10 attempts per 15 minutes per client IP.

> **Reverse proxy:** the server runs with `trustProxy: true` and takes the client IP from
> `X-Forwarded-For`. That is correct behind Traefik, nginx or a similar proxy, which sets the
> header itself. Without such a proxy in front, a caller can send the header with any value
> and so appears under a different IP on every attempt — the login rate limit and the
> per-client IP checks then rely on a value the caller controls. Expose port 3010 only
> through a reverse proxy.

## Address Checks for Agent Connections

Three settings decide where an agent connection may come from. They answer different
questions:

| Setting | Scope | Question |
| :------ | :---- | :------- |
| `security.allowed_networks` (server `config.yaml`) | all agents | May *any* agent connect from this network? |
| Allowed IP or network (client editor, per inbound client) | one client | Does this connection come from where *this* client is allowed to be? |
| `allowedNetworks` (agent `config.yaml`) | one agent's listener | May the server dial this agent from this network? |

An empty network list means no restriction. A newly registered inbound client starts out
restricted to the address it registered from. In the client editor that value can be widened
to a network (`192.168.1.0/24`), or the check can be switched off for the client — the right
choice for a host whose address its environment assigns, such as a container on a bridge
network or DHCP without a reservation. Its token is then accepted from anywhere
`allowed_networks` permits.

The editor knows the address of that client's last successful connect and warns when the value
about to be saved would not let it back in. Without that warning the mistake surfaces only at
the agent's next reconnect, with nothing but an offline client to go on.

The agent checks the socket peer (it has no `trustProxy`). Behind a reverse proxy, list the
proxy's address. With Docker port publishing the peer is normally the server's address, but a
userland proxy (for example Docker Desktop, or `127.0.0.1` published ports) shows up as the
bridge gateway instead — check the agent's log line `denied: not in allowedNetworks` for the
address that was actually seen. A wrong `allowedNetworks` can only be fixed on the agent host:
the connection one would fix it over is the one being refused.

## Agent Permissions

The agent runs on the keepalived host and needs exactly what reading keepalived takes — the
shipped `compose.yaml` grants it and nothing more:

| Setting | Why |
| :------ | :-- |
| `pid: host` | To find keepalived's process in `/proc` and send it `SIGUSR1`/`SIGUSR2`. |
| `cap_add: KILL` | To signal a process that runs under another user. Part of Docker's default set; listed so it stays when the defaults are tightened. |
| `cap_add: SYS_PTRACE` | To read the dump through `/proc/<pid>/root`, keepalived's own view of the file system. That is what makes a systemd `PrivateTmp=true` irrelevant. |
| `security_opt: apparmor:unconfined` | Docker's default AppArmor profile forbids reading another process's root even with the capability. Hosts without AppArmor ignore the line. |
| `network_mode: host` | Keeps the agent's web port under the host's address, which outbound mode dials. |

A reading that fails for lack of a permission says which one in the agent's status and in the
activity list (`keepalived could not be read`).

### What These Permissions Amount To

The agent gets no Docker socket, no host file system mount and no privileged mode — and is
still **root on the host in all but name**. `SYS_PTRACE` is not limited to keepalived: it
applies to every process in the host's PID namespace. `/proc/1/root` is the host's whole file
system, `/proc/<pid>/environ` every process's environment, and without a user namespace
(which `pid: host` rules out) the container's root is the host's root, so root-owned host
files are readable and writable through that path. `ptrace` itself is allowed as well, which
means code can be injected into host processes.

Treat the agent accordingly: whoever takes it over takes over the host. What limits that is
its attack surface — set `allowedNetworks`, and disable the register page once no
re-registration is expected.

### Hardening

`compose.yaml` takes away what the agent does not need:

| Setting | Effect |
| :------ | :----- |
| `cap_drop: ALL` | Leaves nothing but `KILL` and `SYS_PTRACE`. Gone are, among others, `NET_RAW` (forged VRRP or ARP packets on the host network), `DAC_OVERRIDE` (files of other users), `CHOWN`, `SETUID` and `MKNOD`. |
| `security_opt: no-new-privileges:true` | A setuid binary cannot raise privileges again. |
| `read_only: true`, `tmpfs: /tmp` | The agent writes `config.yaml` and its data volume, nothing else. |

**`client-config.yaml` has to belong to root** (`sudo chown root: client-config.yaml`).
Without `DAC_OVERRIDE` root in the container can write only files it owns; a file belonging
to the operator's user stays readable, but the identity from registration is not saved
(`Failed to save config.yaml` in the agent's log) and the agent has to be registered again
after a restart.

None of this closes the two paths above. That takes a custom seccomp profile (Docker's default
without `ptrace`, `process_vm_readv` and `process_vm_writev` — reading `/proc/<pid>/root`
needs the capability, not the syscall) or a custom AppArmor profile in place of `unconfined`.

The agent can also run without a container, as root, with `node client/dist/index.js`.

## Faster Failover Detection

By default the agent reads keepalived every 5 seconds, so a failover reaches the dashboard up
to 5 seconds late. keepalived can tell the agent itself, in two ways; switch on either, both,
or neither. They only trigger a reading — the state still comes from keepalived's dumps — so
leave the timer on as a safety net unless a trigger has been seen to work
(the agent's status page lists the active ones under **Change Detection**).

### Notify FIFO

keepalived writes a line to a FIFO on every state change. In `keepalived.conf`:

```
global_defs {
    vrrp_notify_fifo /run/kasm-notify.fifo
}
```

and in the agent's `config.yaml` the same path, as keepalived sees it (or `KASM_NOTIFY_FIFO`):

```yaml
keepalived:
    notifyFifo: /run/kasm-notify.fifo
```

No further permission is needed: the agent opens the FIFO through `/proc/<pid>/root`, like the
dumps, and reopens it after a keepalived restart. **A FIFO has one reader.** If
`vrrp_notify_fifo` is already set and read by something else — a `vrrp_notify_fifo_script`,
for instance — use the notify script below instead; two readers would each get only part of
the lines.

### Notify Script

keepalived runs a script on every state change, and
[`client/scripts/kasm-notify.sh`](https://github.com/stefgo/keepalived-status-monitor/blob/main/client/scripts/kasm-notify.sh)
passes it on to the agent's `POST /api/keepalived/notify` with `curl`. On the host:

```bash
sudo install -m 0755 kasm-notify.sh /etc/keepalived/kasm-notify.sh
openssl rand -hex 24 | sudo tee /etc/keepalived/kasm-notify.token >/dev/null
sudo chmod 600 /etc/keepalived/kasm-notify.token
```

In `keepalived.conf` — on every instance or sync group whose changes should be reported:

```
global_defs {
    enable_script_security
    script_user root
}

vrrp_instance VI_1 {
    notify /etc/keepalived/kasm-notify.sh
}
```

and in the agent's `config.yaml` the token from the file (or `KASM_NOTIFY_TOKEN`):

```yaml
keepalived:
    notifyToken: <contents of /etc/keepalived/kasm-notify.token>
```

The script calls `http://127.0.0.1:3011`; with another `listenPort`, change `URL` at the top of
the script. It never fails, so an agent that is down does not fill keepalived's log. The
endpoint is not restricted by `allowedNetworks` — its caller is keepalived on the same host —
but by the token; it triggers a reading and does nothing else.

## Health

Both images declare a `HEALTHCHECK`, and `compose.yaml` repeats it, so `docker ps` shows
`(healthy)` next to the containers:

```bash
curl -fsS http://localhost:3010/api/health   # server: process and database
curl -fsS http://localhost:3011/api/health   # agent: process only
```

- **The agent's check covers neither its server connection nor keepalived.** An agent that
  cannot reach the server, or finds keepalived stopped, is still running and doing its job;
  both are shown on its status page and reported to the server.
- An agent whose `config.yaml` disables the web server (`enableStatusPage: false`,
  `enableRegisterPage: false`, no outbound mode) has nothing on port 3011 to answer. Set
  `healthcheck: { disable: true }` for that service.
- **Docker does not restart an unhealthy container.** `restart: unless-stopped` reacts to a
  process exiting, not to its health. The state is for monitoring and for
  `depends_on: condition: service_healthy`.

## Security Headers

The server sends a Content-Security-Policy and the usual hardening headers (via
`@fastify/helmet`). The policy allows scripts only from the server itself, styles and
fonts additionally from Google Fonts, and WebSocket connections to the same host. If a
reverse proxy injects scripts or other resources into the dashboard, those are blocked.

`Strict-Transport-Security` is **off** unless `security.hsts: true` is set, because many
installations run on plain HTTP. Behind TLS, either enable it here or let the reverse proxy
send it.

## TLS to an Outbound Agent

An outbound agent is dialled by the server, and the agent's auth token travels in the
`/ws/agent` query string. Over plain `ws://` that token is readable by anything on the path,
which matters as soon as the agent sits somewhere the operator does not control end to end.

Two settings, one on each side:

1. The agent serves TLS — a `tls` block naming a certificate and key in its `config.yaml`
   (see [client.md](client.md)), or a reverse proxy terminating TLS in front of it.
2. The client's **target address** says so: `wss://host:port` instead of `host:port`, set in
   the client editor or when the client is added.

They have to agree. An address written `wss://` against an agent serving plain HTTP fails to
connect, and so does a bare address against an agent serving TLS. Addresses stored before
this existed keep working unchanged — a bare `host:port` still means `ws://`.

By default the server verifies the agent's certificate, so a wrong or expired one is a failed
connection rather than a silent one. An agent on a home network usually carries a self-signed
certificate, and running a CA for a handful of hosts is more than that warrants:

```yaml
security:
    allow_self_signed_agent_certificates: true
```

It applies to every outbound agent alike and only where the address is `wss://` — a plaintext
target has no certificate to check. This is the mirror image of `allowSelfSignedCertificates`
in the agent's own configuration, which is the same decision for the other direction of the
same link.
