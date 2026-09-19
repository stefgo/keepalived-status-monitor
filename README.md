# Keepalived Status Monitor (KASM)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-v22+-green.svg)](https://nodejs.org/) ![Build Workflow](https://github.com/stefgo/keepalived-status-monitor/actions/workflows/build.yml/badge.svg)

<img src="docs/assets/favicon.svg" alt="" width="72" align="right">

The **Keepalived Status Monitor** (KASM) watches every host in your infrastructure that runs
[keepalived](https://www.keepalived.org) and shows, in one dashboard, which node holds which
virtual address — and tells you when that changes. It consists of a lightweight Node.js agent
next to each keepalived and a central Fastify/React server with a dashboard and API.

## 🚀 Features

- **VRRP at a glance:** Every VRRP instance on every host with its state (MASTER, BACKUP,
  FAULT), configured and effective priority, interface, VRID, virtual addresses and the time
  of its last transition.
- **Cluster view:** Instances of all hosts are grouped by virtual router. Each cluster is
  checked for **split brain** (more than one MASTER), **no MASTER** and degraded members.
- **Failover history:** Every state change is recorded with keepalived's own timestamp and a
  severity — a MASTER stepping down is a warning, FAULT an error. The agent compares its
  readings itself, so a failover during a server outage is reported once it is back.
- **Counters:** keepalived's per-instance statistics (advertisements, priority-zero packets,
  authentication errors, …).
- **Real-time:** Agents push their readings over WebSockets; the dashboard updates live.
- **Nothing sensitive leaves the host:** The agent reads keepalived's state dump and passes on
  only the fields it names — `auth_pass` and the rest of the configuration stay on the host.
  It needs no Docker socket and no host file system mount.
- **Secure registration:** Agents register with a short-lived token and a setup PIN, then
  authenticate with a permanent token. Connections are checked against a server-wide network
  list and each client's own allowed address or network.
- **Authentication:** Local username/password and OIDC (OpenID Connect) for single sign-on,
  configurable per user.
- **Automated maintenance:** Scheduled cleanup of used or expired registration tokens and of
  old activity.

## 🏗 Architecture

The project is a monorepo with four components:

1. **Server Backend (`server/backend`):** A Fastify API server acting as the control plane.
   Manages client registrations, user authentication, the last keepalived reading of every
   host (SQLite) and the activity log.
2. **Server Frontend (`server/frontend`):** A React SPA built with Vite and Tailwind CSS:
   dashboard, VRRP clusters, clients, activity and administration.
3. **Client Agent (`client`):** A lightweight Node.js daemon next to keepalived. It asks
   keepalived for its state (SIGUSR1/SIGUSR2), reads the dumps, and streams the result and
   every state change to the server over a persistent WebSocket.
4. **Shared Library (`shared`):** Single source of truth for TypeScript types, Zod validation
   schemas, WebSocket event constants and the cluster grouping used by server and dashboard.

## 📚 Documentation

The full documentation is published at
**[stefgo.github.io/keepalived-status-monitor](https://stefgo.github.io/keepalived-status-monitor/)**; its sources live in the [`docs/`](./docs) directory:

- [Installation & Setup](https://stefgo.github.io/keepalived-status-monitor/install/) — Build, configure, and run the project locally or via Docker.
- [API Documentation](https://stefgo.github.io/keepalived-status-monitor/api/) — Full specification of the REST and WebSocket APIs.
- [Backend Architecture](https://stefgo.github.io/keepalived-status-monitor/backend/) — Services, repositories, database schema, and authentication flows.
- [Frontend Architecture](https://stefgo.github.io/keepalived-status-monitor/frontend/) — React feature structure, stores, and routing.
- [Client Agent](https://stefgo.github.io/keepalived-status-monitor/client/) — Agent architecture and how it reads keepalived.
- [Development & Deployment](https://stefgo.github.io/keepalived-status-monitor/development/) — Dev environment setup, build pipeline, and multi-arch deployment.

## 🐳 Quick Start (Docker Compose)

### Server

The easiest way to get the server running is using Docker Compose. A production-ready example `compose.yaml` could look like this:

```yaml
services:
    kasm-server:
        container_name: kasm-server
        # The image is multi-platform and supports both x86_64 and ARM64
        image: ghcr.io/stefgo/kasm-server:latest
        ports:
            - "3010:3010"
        volumes:
            - ./server-data:/app/server/backend/data
            - ./server-config.yaml:/app/server/config.yaml
        restart: unless-stopped
        environment:
            - NODE_ENV=production
```

`latest` is the last release. See [Container Images](https://stefgo.github.io/keepalived-status-monitor/install/#container-images) for `main`, `dev` and version tags.

1. Copy `server/config.example.yaml` to `server-config.yaml` and configure your settings (like OIDC).
2. Run `docker compose up -d`
3. Access the dashboard at `http://localhost:3010` (Default credentials: `admin` / `admin`).

### Client

The agent runs on each keepalived host. It needs to see keepalived's process, so it shares the
host's PID namespace, and it reads keepalived's state files through `/proc/<pid>/root`:

```yaml
services:
    kasm-client:
        container_name: kasm-client
        # Supports both x86_64 and ARM64 (e.g. Raspberry Pi)
        image: ghcr.io/stefgo/kasm-client:latest
        network_mode: host
        pid: host
        cap_add:
            - KILL          # signal keepalived to write its state
            - SYS_PTRACE    # read that state through /proc/<pid>/root
        security_opt:
            - apparmor:unconfined
        volumes:
            - ./client-config.yaml:/app/client/config.yaml
            # The agent's own state: its last reading and unacknowledged activity.
            - client-data:/app/client/data
        restart: unless-stopped
        environment:
            - NODE_ENV=production

volumes:
    client-data:
```

1. Copy `client/config.example.yaml` to `client-config.yaml`. If your `keepalived.conf` moves
   the dump files (`state_dump_file`, `stats_dump_file`), set the same paths under
   `keepalived:`.
2. In the server dashboard choose **Add Client** and pick "The agent connects to this server"
   to get a registration token — the wizard also takes the display name and allowed address
   the client should start with. Start the agent and open its web UI at
   `http://<host>:3011/register`. Enter the server URL, the token and the **setup PIN** the
   agent prints to its log (`docker logs kasm-client`). The agent then writes the permanent
   `authToken` to the config file.
3. Run `docker compose up -d`.

## 🔧 Development

### Prerequisites

- Node.js v22+
- npm v10+

### Local Setup

1. Clone the repository: `git clone https://github.com/stefgo/keepalived-status-monitor`
2. Install dependencies: `npm install`
3. Build the shared library: `npm run build -w shared`
4. Start the backend: `npm run dev:server`
5. Start the frontend dev server (Vite, hot reload): `npm run dev:frontend`
6. Start a test client: `npm run dev:client`

For a realistic setup with two keepalived nodes, run `docker compose -f compose.dev.yaml up
--build`: it starts the server, two keepalived containers forming two VRRP clusters, and one
agent next to each — see the comment at the top of `compose.dev.yaml` for failover on demand.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request. For major changes, please open an issue first to discuss what you would like to change.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
