# Operations

Running KASM once it is installed: which image to pull, how to upgrade, what to back up, and
how to tell that it is healthy.

## Images and tags

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

## Upgrading

```bash
docker compose pull
docker compose up -d
```

- **Read the [upgrade notes](upgrade-notes.md) first.** They say what a release changes and
  what an existing installation has to do about it.
- **Server first, then the agents.** The two are updated separately and every build speaks
  to one of another age, but the protocol assumes the server is never the older of the two.
- The database schema is migrated automatically when the server starts.
- An agent that is restarted still reports a failover that happened meanwhile: it keeps its
  last reading in its data volume and compares against it.

## Backup

| What | Where | Why |
| :--- | :---- | :-- |
| Server database | `server-data` volume (`/app/server/backend/data`) | Users, clients, tokens, webhooks, activity |
| Server config | `server-config.yaml` | Session key, the `secretKey` that encrypts the outbound clients' tokens, OIDC, settings — without the `secretKey` every outbound client has to be registered again |
| Agent state | `client-data` volume on each host | Its identity — lose it and the agent has to be registered again |

The database is SQLite in WAL mode, so copy it with the server stopped:

```bash
docker compose stop kasm-server
docker run --rm -v kasm-server_server-data:/data -v "$PWD":/backup alpine \
    tar czf /backup/kasm-server-data.tgz -C /data .
docker compose start kasm-server
```

(The volume name is prefixed with the compose project, usually the directory name —
`docker volume ls` shows it.)

keepalived's state itself is not backed up by KASM: it is read again from each host on every
connect.

## Health

Both images declare a `HEALTHCHECK`, and `compose.yaml` repeats it, so `docker ps` shows
`(healthy)` next to the containers:

```bash
curl -fsS http://localhost:3010/api/health   # server: process and database
curl -fsS http://localhost:3011/api/health   # agent: process only, on the agent's host
```

The agent's route exists for the `HEALTHCHECK` alone: it is served only in the container
image and answers only loopback. The agent runs with `network_mode: host`, so the host's
loopback is its own and the `curl` above works there — from any other machine it gets a
`404`.

- **The agent's check covers neither its server connection nor keepalived.** An agent that
  cannot reach the server, or finds keepalived stopped, is still running and doing its job;
  both are shown on its status page and reported to the server.
- The route is there whatever `config.yaml` disables: with both pages off and no outbound
  mode the agent still starts its web server for it, bound to `127.0.0.1`. A `404` from
  another machine is the loopback rule, not a broken agent.
- **The checks follow the port the process actually listens on.** Neither reads
  `config.yaml`: once server and agent listen, each writes the address it serves to
  `/tmp/kasm-health.json` inside its container, and the check asks that. A `port` or
  `listenPort` moved in `config.yaml` is followed like one moved through `KASM_SERVER_PORT` or
  `KASM_CLIENT_PORT`, and so is the agent's `tls` block — the certificate is not verified, since
  the check only ever asks `127.0.0.1`. The commands above assume the default ports.
- **Without that file the server's check fails; the agent's falls back.** The server's check
  has nothing else to ask and reports `unhealthy` — during start-up, which `start_period`
  covers, and when the repository's `compose.yaml` runs an image from before the file
  existed. The agent's check then asks `KASM_CLIENT_PORT` (default `3011`), plain HTTP first
  and HTTPS only when the connection fails. A `healthcheck:` block of your own should read the
  same file.
- **Docker does not restart an unhealthy container.** `restart: unless-stopped` reacts to a
  process exiting, not to its health. The state is for monitoring and for
  `depends_on: condition: service_healthy`.

## Logs

```bash
docker logs -f kasm-server
docker logs -f kasm-client
```

`LOG_LEVEL=debug` (or `logLevel` in either `config.yaml`) makes both talkative;
`LOG_FORMAT=json` for a log collector. See
[Configuration](configuration.md#environment-variables).

## Changing the port

`KASM_SERVER_PORT` / `port` and `KASM_CLIENT_PORT` / `listenPort` move the listen ports. Move
the server's compose port mapping with it; the agent runs on the host network and has none.
On the other side:

- a moved **server** port changes every agent's server URL — edit `serverUrl` in each agent's
  `config.yaml`;
- a moved **outbound agent** port changes its target address — edit it in the client editor;
- a moved **agent** port changes the `URL` at the top of
  [the notify script](configuration.md#notify-script), if you use it.
