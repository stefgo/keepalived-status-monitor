# Configuration

KASM is configured in three places:

| Where | What goes there |
| :---- | :-------------- |
| **Dashboard → Settings** | Retention of registration tokens and of the activity list. Stored in the `settings` block of the server's `config.yaml`. |
| **Server `config.yaml`** | Sign-in (OIDC, sessions), port, network restrictions — what needs a restart. |
| **Agent `config.yaml`** | Per host: server URL, how keepalived is read, port, TLS, which local pages are served. |

[Environment variables](#environment-variables) override a few keys of both files.

## Server `config.yaml`

Mounted at `/app/server/config.yaml`. A commented template is
[`server/config.example.yaml`](https://github.com/stefgo/keepalived-status-monitor/blob/main/server/config.example.yaml).

Created automatically on first start. Contains advanced settings for authentication and security.

The server checks the file on every start. A value of the wrong type or format — `hsts: "yes"`, an invalid CIDR, `oidc.enabled: true` without an `issuer` — stops the start with exit code 1 and a log line that names the field:

```
Invalid config.yaml -- security.hsts: Invalid input: expected boolean, received string
```

Fix the value and start again. Unknown keys are kept and do not cause an error; the server
logs a warning for each one at startup (`Unknown key in config.yaml -- ignored`), so a
misspelled key does not leave its default in force unnoticed.

| Key                        | Sub-Key         | Description                                              |
| :------------------------- | :-------------- | :------------------------------------------------------- |
| `jwtSecret`                | —               | JWT signing secret. Auto-generated on first run.         |
| `secretKey`                | —               | Encrypts the auth tokens the server stores for outbound clients. Auto-generated on first run; do not copy it between installations. Losing or changing it means every outbound client has to be registered again. |
| `oidc`                     | `enabled`       | Enables or disables OIDC login (`true`/`false`).         |
|                            | `issuer`        | OIDC Issuer URL.                                         |
|                            | `client_id`     | OIDC Client ID.                                          |
|                            | `client_secret` | OIDC Client Secret.                                      |
|                            | `redirect_uri`  | OIDC Redirect URI.                                       |
| `jwtExpiresIn`             | —               | JWT session lifetime (e.g. `"24h"`). Defaults to `"12h"`. Tokens always expire; the session cookies expire with them, and the dashboard logs out when they do. |
| `settings`                 | `token_retention_days` / `token_cleanup_interval_hours` | Retention of used/expired registration tokens (defaults 30 days, every 24 h). |
|                            | `notification_retention_days` / `_count` / `notification_cleanup_interval_hours` | Retention of the activity list (defaults 90 days, at least 500 kept, every 24 h). |
|                            | `activity_level_overrides` | The level an event kind is recorded with, as `kind=level` entries separated by commas, e.g. `keepalived.stopped=error, client.connected=none`; edited under **Settings → Activity History → Event Levels**. `level` is `trace`, `info`, `warning`, `error`, or `none`, which keeps the kind out of the activity and away from the webhooks. An override is fixed for the whole kind, applies to events from then on and leaves the stored ones as they are; a webhook compares its minimum level with the overridden one. `vrrp.incident_opened` and `vrrp.incident_resolved` cannot be set to `none`. Default `""`; a value that cannot be read stops the server at startup. |
| `logLevel`                 | —               | pino log level; `LOG_LEVEL` wins when set.               |
| `port`                     | —               | Listen port (default `3010`); `KASM_SERVER_PORT` wins when set. The published port: `EXPOSE`, the compose port mapping and every agent's `serverUrl` have to follow it. |
| `security`                 | `allowed_networks` | IPv4 addresses or CIDR networks an agent may open `/ws/agent` from, for all agents alike. Empty (default) allows every address. |
|                            | `trusted_proxies` | Reverse proxies whose `X-Forwarded-For` and `X-Forwarded-Proto` the server believes: IP addresses, CIDR networks (v4 or v6), or `loopback`, `linklocal`, `uniquelocal`. Empty (default) believes no one. **Behind a proxy, list it** — see [Reverse proxy](security.md#reverse-proxy). Requires a restart; `KASM_TRUSTED_PROXIES` wins. |
|                            | `hsts`          | Send `Strict-Transport-Security` (default `false`). Enable only when the dashboard is served exclusively over HTTPS — browsers remember the header for months. Requires a restart. |
|                            | `allow_self_signed_agent_certificates` | Accept a certificate the server cannot verify when it dials an outbound agent over `wss://` (default `false`). See [TLS to an Outbound Agent](security.md#tls-to-an-outbound-agent). |

On first start the file has to be **writable**: the server writes the generated `jwtSecret`
and `secretKey` into it, and refuses to encrypt with a `secretKey` it could not write back.
What the two protect is listed under [What is stored where](security.md#what-is-stored-where).

## Agent `config.yaml`

Mounted at `/app/client/config.yaml`. A commented template is
[`client/config.example.yaml`](https://github.com/stefgo/keepalived-status-monitor/blob/main/client/config.example.yaml).

Created automatically during registration, or can be set up manually using `client/config.example.yaml` as a template. The identity the server issues — the client id and the auth token — is **not** in this file: it lives in `identity.json` in the agent's data directory (`KASM_CLIENT_DATA_DIR`).

An agent the server dials (outbound mode) needs no entry here to be registered: enter the
**Setup PIN** from `docker logs kasm-client` in the dashboard's **Add Client** wizard, or give
the agent `KASM_REGISTRATION_SECRET` and enter that instead (see
[Outbound registration](client.md#outbound-registration)). A `registrationSecret` in this
file is no longer read.

| Key          | Description                                                                    |
| :----------- | :----------------------------------------------------------------------------- |
| `logLevel`   | Log verbosity for the client agent.                                            |
| `serverUrl`  | HTTP(S) URL of the management server (e.g., `https://manager.example.com`). Set it here, or let a registration through the agent's web UI write it. |
| `keepalived.pollInterval` | Seconds between two readings (default `5`); `0` switches the timer off, which needs one of the two below. |
| `keepalived.notifyFifo` | keepalived's `vrrp_notify_fifo` as keepalived sees the path; every line in it triggers a reading. Unset by default. See [Faster Failover Detection](#faster-failover-detection). |
| `keepalived.notifyToken` | Token for `POST /api/keepalived/notify`, which a keepalived notify script calls; at least 16 characters. Unset by default: the endpoint does not exist. |
| `keepalived.dataFile` / `statsFile` / `jsonFile` | Where keepalived writes its dumps, as keepalived sees the path (defaults `/tmp/keepalived.data`, `.stats`, `.json`). Match `state_dump_file`, `stats_dump_file` and `json_dump_file` if `keepalived.conf` sets them. |
| `keepalived.jsonSignal` | Read the JSON dump instead of the text dump: the number `keepalived --signum=JSON` prints on the host. Only for a keepalived built with `--enable-json`. Unset by default. |
| `keepalived.dumpTimeoutMs` | How long to wait for keepalived to write a dump (default `3000`); the signal is sent once more before a reading fails. |
| `listenPort` | Port of the local web server (default `3011`); `KASM_CLIENT_PORT` wins over it. |
| `enableStatusPage` / `enableRegisterPage` | Serve the status page and the registration page with `POST /api/register` (both default `true`). The registration page closes by itself once the agent is registered. |
| `allowSelfSignedCertificates` | Accept a server certificate that does not validate (self-signed), for registration and the WebSocket connection. Default `false`. |
| `allowedNetworks` | IPv4 addresses or CIDR networks the **server** may dial this agent from, checked on `/ws/register` and `/ws/agent`. Empty (default) allows every address. The local web UI is not restricted by it. An invalid entry stops the agent with a log line naming it. |
| `tls.cert` / `tls.key` | Serve the agent's web server over TLS, so the server can dial it as `wss://`. Unset (default): plain HTTP. A block that cannot be read ends the start. See [TLS to an Outbound Agent](security.md#tls-to-an-outbound-agent). |

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

## Environment Variables

| Variable      | Values                           | Default       | Description                                                                   |
| :------------ | :------------------------------- | :------------ | :---------------------------------------------------------------------------- |
| `LOG_LEVEL`   | `trace`, `debug`, `info`, `warn`, `error`, `fatal`, `silent` | `info` | Controls log verbosity. Wins over `logLevel` in `config.yaml`. |
| `LOG_FORMAT`  | `pretty`, `json`                 | _auto_        | `pretty` for colored single-line logs (default in dev), `json` for prod.      |
| `KASM_SERVER_PORT` | `1`–`65535`                 | `3010`        | Port the server listens on; wins over `port` in `config.yaml`. An unusable value ends the start. The container's health check follows the port either way (see [Health](operations.md#health)). |
| `KASM_TRUSTED_PROXIES` | IPs, CIDRs, `loopback`, `linklocal`, `uniquelocal`, comma separated | _unset_ | Reverse proxies whose `X-Forwarded-*` headers the server believes; wins over `security.trusted_proxies`. An unusable entry ends the start. See [Reverse proxy](security.md#reverse-proxy). |
| `NODE_ENV`    | `development`, `production`      | `development` | Picks the log format when `LOG_FORMAT` is unset (`production` → JSON).        |
| `KASM_CLIENT_PORT` | `1`–`65535`                  | `3011`        | _(Client only)_ Port of the local web server; wins over `listenPort` in `config.yaml`. An unusable value ends the start. |
| `KASM_CLIENT_DATA_DIR` | path                     | `/app/client/data` | _(Client only)_ Where the agent keeps its own state: the identity it was issued at registration (`identity.json`), its last keepalived reading and unacknowledged activity events. Set it when the agent runs outside the shipped `compose.yaml`. **Losing this directory means registering the agent again.** |
| `KASM_CLIENT_CONFIG` | path                       | `/app/client/config.yaml` | _(Client only)_ The agent's `config.yaml`. Lets several agents run from one checkout, as in `compose.dev.yaml`. |
| `KASM_PROC_DIR` | path                              | `/proc`       | _(Client only)_ Where the agent looks for keepalived's process. Only for tests against a copied process tree. |
| `KASM_NOTIFY_FIFO` | path                           | _unset_       | _(Client only)_ keepalived's `vrrp_notify_fifo`; wins over `keepalived.notifyFifo`. See [Faster Failover Detection](#faster-failover-detection). |
| `KASM_NOTIFY_TOKEN` | string, ≥ 16 characters       | _unset_       | _(Client only)_ Token of the notify endpoint; wins over `keepalived.notifyToken`. See [Faster Failover Detection](#faster-failover-detection). |
| `KASM_REGISTRATION_SECRET` | string                 | _unset_       | _(Client only)_ Outbound mode: a secret the **Add Client** wizard accepts in place of the setup PIN from the agent's log, for a rollout where nobody reads that log. Remove it once the agent is registered. |
| `KASM_REGISTRATION_SECRET_FILE` | path              | _unset_       | _(Client only)_ The same, read from a file (e.g. `/run/secrets/…`). Setting both variables, or a file that cannot be read or is empty, ends the start. |

In Compose they go into the service's `environment:` block:

```yaml
        environment:
            - NODE_ENV=production
            - LOG_LEVEL=debug
```
