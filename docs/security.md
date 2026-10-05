# Security

An agent is root on its keepalived host in all but name, and the server reaches every agent.
This page lists what protects that chain and what you have to set up yourself.

## Checklist

- The `admin` / `admin` password is changed ([Quick Start](quickstart.md#2-sign-in)).
- The server is reachable only through a reverse proxy with TLS, and that proxy is listed in
  `security.trusted_proxies` ([below](#reverse-proxy)).
- Agents that the server dials outside a trusted network serve TLS
  ([below](#tls-to-an-outbound-agent)).
- `allowedNetworks` is set on agents the server dials, and `enableRegisterPage: false` on
  agents that will not be registered through their web UI.
- The agents' data volumes are readable only by root — they hold each agent's auth token.
- The agent container runs with the restrictions of the shipped `compose.yaml`
  ([below](#hardening)).

## Sign-in

- Local accounts (bcrypt) and OIDC single sign-on (`oidc` in the
  [server's `config.yaml`](configuration.md#server-configyaml)).
- Sessions are an httpOnly cookie that expires after `jwtExpiresIn` (default 12 h); the
  dashboard signs out when it does.
- Changing a user's password or auth methods, or deleting the user, ends all of that user's
  sessions at once, open dashboards included.
- `POST /api/login` accepts at most **10 attempts per 15 minutes** per client IP.

## Reverse proxy

The server believes `X-Forwarded-For` and `X-Forwarded-Proto` only from the proxies listed in
`security.trusted_proxies` (or `KASM_TRUSTED_PROXIES`). The list is empty by default, so the
client address is the connection's own and a caller cannot choose it by sending the header —
port 3010 can be published directly.

**Behind a proxy, list it:**

```yaml
security:
    # A proxy on the same host:
    trusted_proxies: ["loopback"]
    # A proxy container on a Docker network (its address is assigned by Docker):
    # trusted_proxies: ["uniquelocal"]
```

Without the entry nothing fails outright, but three things go wrong quietly:

- Every request appears to come from the proxy. The login rate limit then counts all users
  together, and `security.allowed_networks` and a client's allowed address are checked
  against the proxy's address.
- A new inbound client is restricted to the proxy's address instead of the agent's.
- The session cookies lose `Secure`, because the server sees the proxy's plain-HTTP
  connection rather than the browser's HTTPS one.

The startup log says which proxies are trusted, or that none are.

The proxy has to pass WebSockets (`/ws/dashboard`, `/ws/agent`) and should send
`X-Forwarded-Proto`, so the session cookies are marked `Secure`.

## Security Headers

The server sends a Content-Security-Policy and the usual hardening headers (via
`@fastify/helmet`). The policy allows scripts, styles and fonts only from the server itself, and WebSocket connections
to the same host. The font ships with the bundle, so no other origin is named. If a
reverse proxy injects scripts or other resources into the dashboard, those are blocked.

`Strict-Transport-Security` is **off** unless `security.hsts: true` is set, because many
installations run on plain HTTP. Behind TLS, either enable it here or let the reverse proxy
send it.

## Agent registration

- A registration token is valid for one registration. The server keeps its SHA-256 hash.
- Every registration additionally needs the agent's **setup PIN** from its log, or its
  `KASM_REGISTRATION_SECRET` — someone who can reach port 3011 cannot point the agent at a
  server of their own. See [Setup PIN](client.md#setup-pin-srccoresetuppints).
- The server issues the client id and a permanent auth token. The agent authenticates with
  both on every connection.

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

The server checks the connection's peer — or, when that peer is listed in
`security.trusted_proxies`, the address the proxy forwarded. The agent checks the socket peer
(it has no `trustProxy`). Behind a reverse proxy, list the
proxy's address. With Docker port publishing the peer is normally the server's address, but a
userland proxy (for example Docker Desktop, or `127.0.0.1` published ports) shows up as the
bridge gateway instead — check the agent's log line `denied: not in allowedNetworks` for the
address that was actually seen. A wrong `allowedNetworks` can only be fixed on the agent host:
the connection one would fix it over is the one being refused.

## TLS to an Outbound Agent

An outbound agent is dialled by the server, and the agent's auth token travels in the
`/ws/agent` query string. Over plain `ws://` that token is readable by anything on the path,
which matters as soon as the agent sits somewhere the operator does not control end to end.

Two settings, one on each side:

1. The agent serves TLS — a `tls` block naming a certificate and key in its `config.yaml`
   (see [Serving it over TLS](client.md#serving-it-over-tls)), or a reverse proxy terminating TLS in front of it.
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

## What is stored where

| Secret | Stored in |
| :----- | :-------- |
| User passwords (bcrypt), registration tokens (SHA-256), inbound clients' auth tokens (SHA-256) | the server's SQLite database (`server-data` volume) — hashes only, the server just has to recognise the value |
| Outbound clients' auth tokens | the server's SQLite database, encrypted (AES-256-GCM) with `secretKey` — the server presents them when it dials, so it has to read them back |
| Session signing key (`jwtSecret`), encryption key (`secretKey`), OIDC client secret | the server's `config.yaml` |
| The agent's client id and auth token | `identity.json` in the agent's `client-data` volume, readable by root only |

The database and `config.yaml` are kept apart on purpose — a volume and a bind-mounted file —
so a copy of the volume alone contains no usable agent token. Back them up separately.

What the agent reads from keepalived is taken over field by field: `auth_pass` and anything
else it does not name never leave the host.

## Container users

The server process runs as the unprivileged user `node` (UID 1000), not as root. The
container starts as root only for a moment: its entrypoint hands the data volume and, when
the server cannot write it, the mounted `server-config.yaml` to UID 1000, then drops to
that user. So an installation from an older image keeps working after an update, but
`server-config.yaml` on the host may afterwards belong to UID 1000. Check with
`docker top kasm-server`, not `docker exec … id`: `exec` starts its shell as root.

To pick the UID yourself, set `user: "1234:1234"` on the service. The entrypoint then
changes nothing, and the volume and the config file have to be writable by that UID —
otherwise the server stops at start-up and names the directory it cannot write.

The agent stays root on purpose; what it may do is the next section.

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
its attack surface — set `allowedNetworks`, and disable the register page for an agent the
server registers (outbound). An inbound agent's register page closes once it is registered.

### Hardening

`compose.yaml` takes away what the agent does not need:

| Setting | Effect |
| :------ | :----- |
| `cap_drop: ALL` | Leaves nothing but `KILL` and `SYS_PTRACE`. Gone are, among others, `NET_RAW` (forged VRRP or ARP packets on the host network), `DAC_OVERRIDE` (files of other users), `CHOWN`, `SETUID` and `MKNOD`. |
| `security_opt: no-new-privileges:true` | A setuid binary cannot raise privileges again. |
| `read_only: true`, `tmpfs: /tmp` | The agent writes `config.yaml` and its data volume, nothing else. |

**`client-config.yaml` has to belong to root** (`sudo chown root: client-config.yaml`).
Without `DAC_OVERRIDE` root in the container can write only files it owns; a file belonging
to the operator's user stays readable, but the server URL of a registration through the web
UI is not written back (`Failed to save config.yaml` in the agent's log). The identity itself
is not affected: it goes to `identity.json` in the data volume.

None of this closes the two paths above. That takes a custom seccomp profile (Docker's default
without `ptrace`, `process_vm_readv` and `process_vm_writev` — reading `/proc/<pid>/root`
needs the capability, not the syscall) or a custom AppArmor profile in place of `unconfined`.

The agent can also run without a container, as root, with `node client/dist/index.js`.
