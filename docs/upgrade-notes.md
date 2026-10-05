# Upgrade Notes

What changed in behaviour or configuration between releases, and what to do about it when
upgrading. **Newest first.** The general procedure is in
[Operations](operations.md#upgrading); the release history is in
[CHANGELOG.md](https://github.com/stefgo/keepalived-status-monitor/blob/main/CHANGELOG.md).

Everything below came after release 1.0.0 and is in the `main` and `dev` images.

## The agent sets a damaged identity aside

An `identity.json` that cannot be read used to be dropped with a warning, and the next
registration wrote over the only copy. The agent now renames it to
`identity.json.corrupt-<timestamp>` and reports an error.

- Nothing to do on upgrade. If an agent comes up unregistered, look for that file in its
  data volume before registering it again.
- The data directory is set to mode `0700` and its files to `0600` at every start.

## The web interface forgets its view settings once

The keys the web interface stores its preferences under in the browser were renamed to one
scheme (`kasm.<area>.<what>`), without carrying the old values over.

- **Once per browser, after the upgrade:** the theme, the sidebar and every list are back to
  their defaults. Set them again; they are remembered as before.
- Nothing on the server is affected, and nobody is signed out by this.

## The client pages have new addresses

A client's page and its editor moved below the list they belong to:

| Before | Now |
| :-- | :-- |
| `/client/:clientId` | `/clients/:clientId` |
| `/client/:clientId/edit` | `/clients/:clientId/edit` |

- **Bookmarks keep working for one release.** The old addresses redirect to the new ones.
  Update bookmarks and links in runbooks before the release after this one.
- The API is not affected: its paths have not changed.

## config.yaml reports unknown keys

The server logs a warning at startup for every key in `config.yaml` it does not know
(`Unknown key in config.yaml -- ignored`). The key is kept and nothing fails.

- Read the startup log once after the upgrade: a warning there is usually a misspelled key
  whose default has been in force all along.

## The server runs as an unprivileged user

The server process runs as `node` (UID 1000) instead of root. The container's entrypoint
hands the data volume and, when the server cannot write it, the mounted
`server-config.yaml` to that user before it drops privileges.

- **Nothing to do for a standard installation.** Afterwards `server-config.yaml` on the host
  may belong to UID 1000.
- With your own `user:` on the service the entrypoint changes nothing; make the volume and
  the config file writable by that UID. See [Security](security.md#container-users).

## Agent tokens are stored protected

The database no longer holds an agent's auth token in the clear. An inbound client's token is
stored as its hash, an outbound client's encrypted with the new `secretKey`, which the server
generates on its first start and writes into `config.yaml`.

- **`config.yaml` has to be writable on the first start after the update.** The server refuses
  to encrypt with a key it could not write back, and stops the start with the database
  untouched.
- **Back up `config.yaml` apart from the data volume.** Losing `secretKey` means registering
  every outbound client again.
- Agents keep their token and connect as before.
- **A downgrade loses the inbound clients.** The hashes cannot be turned back; those agents
  have to be registered again.

## The agent's status check asks only its own server

`GET /api/status/server` on the agent used to probe any address given as `?url=`. It now
checks the configured server and nothing else; the register page reports an unreachable
server itself.

- A script that used the route to test an arbitrary URL no longer can.

## Everyone signs in once

A session now ends when its user's password or auth methods change, or the user is deleted —
at once, open dashboards included. Sessions issued before this change cannot be checked that
way and are refused.

- **Every user has to sign in once after the update.**

## Forwarding headers count only from listed proxies

The server used to believe `X-Forwarded-For` and `X-Forwarded-Proto` from anyone who reached
its port. A caller could thereby choose the address the login rate limit, `allowed_networks`
and a new client's allowed address were taken from. It now believes them only from the proxies
listed in `security.trusted_proxies` (or `KASM_TRUSTED_PROXIES`), and the list is empty by
default.

- **Behind a reverse proxy, list it** — see [Security](security.md#reverse-proxy). Without
  the entry every request appears to come from the proxy, new clients are bound to the
  proxy's address, and the session cookies lose their `Secure` flag.
- The startup log says which proxies are trusted, or that none are.

## Before 1.0.0

### The agent is registered with its setup PIN

A `registrationSecret` in the agent's `config.yaml` is not read. An unregistered agent prints
a **setup PIN** to its log, and a registration needs that PIN or the value of
`KASM_REGISTRATION_SECRET`; see [Setup PIN](client.md#setup-pin-srccoresetuppints).

- Agents that are already registered are not affected.

### The agent's identity lives in its data volume

The client id and the auth token are kept in `identity.json` in the agent's data directory,
not in `config.yaml`.

- **The agent needs a persistent `client-data` volume.** Lose it and the agent has to be
  registered again.
