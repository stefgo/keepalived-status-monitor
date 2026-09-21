# 📚 API Documentation

**Base URL:** `/api` (REST endpoints use `/api/v1` prefix unless otherwise noted)

> **Note:** All API responses are JSON formatted. All protected endpoints require a valid session: the `kasm_session` cookie set by the login, or the same JWT in an `Authorization: Bearer <token>` header.

> **Validation:** Every endpoint that takes a body or query parameters checks them against a Zod schema from `@kasm/shared` before doing anything else. A request that does not match is answered with **`400`** and a single message that starts with the path of the first offending field, e.g. `{ "error": "inboundAllowedIp: Must be an IPv4 address or an IPv4 network in CIDR notation" }`. Only the first problem is reported; fix it and the next request names the next one.

## 📖 Table of Contents

- [Authentication](#-authentication)
    - [Login](#login)
    - [Logout](#logout)
    - [Current Session](#current-session)
    - [OIDC Configuration](#oidc-configuration)
    - [OIDC Login](#oidc-login)
    - [OIDC Callback](#oidc-callback)
- [Users](#-users)
    - [List Users](#list-users)
    - [Create User](#create-user)
    - [Update User](#update-user)
    - [Delete User](#delete-user)
- [Clients](#-clients)
    - [List Clients](#list-clients)
    - [Create Outbound Client](#create-outbound-client)
    - [Update Client](#update-client)
    - [Delete Client](#delete-client)
    - [Reconnect An Outbound Client](#reconnect-an-outbound-client)
- [Registration Tokens](#-registration-tokens)
    - [List Tokens](#list-tokens)
    - [Create Token](#create-token)
    - [Delete Token](#delete-token)
    - [Register Client (Public)](#register-client-public)
- [keepalived](#-keepalived)
    - [List Readings](#list-readings)
    - [List Clusters](#list-clusters)
    - [Get A Client's Reading](#get-a-clients-reading)
    - [Refresh A Client's Reading](#refresh-a-clients-reading)
- [Settings & Maintenance](#-settings--maintenance)
    - [Get Settings](#get-settings)
    - [Update Settings](#update-settings)
    - [Run Invalid Token Cleanup](#run-invalid-token-cleanup)
    - [Run Activity Cleanup](#run-activity-cleanup)
    - [Scheduler Status](#scheduler-status)
- [Activity](#-activity)
    - [List Activity](#list-activity)
    - [Mark Seen](#mark-seen)
    - [Delete Activity](#delete-activity)
- [Misc](#-misc)
    - [Health](#health)
    - [Reachability](#reachability)
- [WebSockets](#-websockets)
    - [Dashboard Connection](#dashboard-connection)
    - [Agent Connection](#agent-connection)
        - [Client -> Server Events](#client---server-events)
        - [Server -> Client Events](#server---client-events)

---

## 🔐 Authentication

### Login

`POST /api/login`

**Description:** Authenticates a user with local credentials and starts a session. The session token is set as a cookie and is not part of the response body.

#### Request Body

| Field      | Type   | Required | Description               |
| :--------- | :----- | :------- | :------------------------ |
| `username` | string | **Yes**  | The username of the user. |
| `password` | string | **Yes**  | The password of the user. |

**Example Request:**

```json
{
    "username": "admin",
    "password": "secretpassword"
}
```

#### Response

```json
{
    "success": true
}
```

The response sets two cookies, both with `Path=/`, `SameSite=Strict` and a `Max-Age` that ends when the token does (`jwtExpiresIn`, default `12h`). `Secure` is added when the request came in over HTTPS (behind a reverse proxy: `X-Forwarded-Proto: https`).

| Cookie        | `HttpOnly` | Content                                                                 |
| :------------ | :--------- | :---------------------------------------------------------------------- |
| `kasm_session` | yes        | The JWT. Sent by the browser on every request and on the WebSocket handshake. |
| `kasm_auth`    | no         | `1`. Carries no secret; tells the dashboard that a session exists.      |

Every protected endpoint accepts the session either as the `kasm_session` cookie or as `Authorization: Bearer <token>`. A script can log in with this endpoint and send the value of `kasm_session` as a bearer token.

- **400** — `username` or `password` missing or empty. A malformed request is not a failed login.
- **401** — `Invalid credentials`: unknown user, wrong password, or an account without a local password (OIDC only). All three answer the same.

#### Rate Limit

At most **10 attempts per 15 minutes** per client IP, successful or not. Further attempts
are answered with `429 Too Many Requests` until the window has passed; the response carries
`x-ratelimit-*` and `retry-after` headers. No other endpoint is rate limited.

### Logout

`POST /api/auth/logout`

**Description:** Ends the browser session by clearing both cookies. Unauthenticated, so that an expired session can be logged out of too. The token itself stays valid until it expires; the server keeps no session list to revoke it from.

#### Response

```json
{
    "success": true
}
```

### Current Session

`GET /api/v1/me`

**Description:** Who the current session belongs to and when it expires. The dashboard reads the username, the user id (for the seen state of notifications) and the expiry (for its automatic logout) from here, because it cannot read the httpOnly cookie. Protected like every `/api/v1` endpoint: without a valid session it answers `401`.

#### Response

| Field       | Type           | Description                                   |
| :---------- | :------------- | :-------------------------------------------- |
| `id`        | number         | The user's id.                                |
| `username`  | string         | The user's name.                              |
| `expiresAt` | string \| null | ISO 8601 time at which the session expires. |

```json
{
    "id": 1,
    "username": "admin",
    "expiresAt": "2026-09-12T06:00:00.000Z"
}
```

### OIDC Configuration

`GET /api/auth/config`

**Description:** Returns the public authentication configuration. Used by the frontend to determine whether to show local login, OIDC login, or both.

#### Response

| Field       | Type   | Description                                |
| :---------- | :----- | :----------------------------------------- |
| `type`      | string | `"oidc"` while an OIDC provider is configured and was discovered at startup, otherwise `"local"`. Local login stays available either way. |

### OIDC Login

`GET /api/auth/login`

**Description:** Redirects the user's browser to the OIDC provider's login page. Generates a PKCE code verifier/challenge and stores state for CSRF protection.

#### Response

- **302 Redirect:** Redirects to the OIDC provider.
- **404** — OIDC is not configured.

### OIDC Callback

`GET /api/auth/callback`

**Description:** Handles the callback from the OIDC provider. Exchanges the authorization code for a local JWT session token.

#### Query Parameters

| Parameter | Type   | Required | Description                                           |
| :-------- | :----- | :------- | :---------------------------------------------------- |
| `code`    | string | **Yes**  | The authorization code returned by the OIDC provider. |
| `state`   | string | **Yes**  | The state parameter for CSRF protection.              |

#### Response

- **302 Redirect:** Sets the session cookies (see [Login](#login)) and redirects to `/`. The token is not put into the redirect URL.
- **500** — `Authentication failed: <reason>`: OIDC is disabled, the state does not match, or the code exchange failed.

---

## 👤 Users

### List Users

`GET /api/v1/users`

**Description:** Retrieves a list of all registered users.

#### Response (Array of User objects)

| Field          | Type   | Description                                             |
| :------------- | :----- | :------------------------------------------------------ |
| `id`           | number | The unique identifier of the user.                      |
| `username`     | string | The username.                                           |
| `auth_methods` | string | Comma-separated list of allowed authentication methods. |
| `created_at`   | string | ISO 8601 timestamp of creation.                         |
| `updated_at`   | string | ISO 8601 timestamp of last update.                      |

**Example Response:**

```json
[
    {
        "id": 1,
        "username": "admin",
        "auth_methods": "local",
        "created_at": "2024-01-01T10:00:00.000Z",
        "updated_at": "2024-01-01T10:00:00.000Z"
    }
]
```

### Create User

`POST /api/v1/users`

**Description:** Creates a new user.

#### Request Body

| Field          | Type   | Required      | Description                                               |
| :------------- | :----- | :------------ | :-------------------------------------------------------- |
| `username`     | string | **Yes**       | The desired username.                                     |
| `password`     | string | _Conditional_ | Required when `auth_methods` includes `"local"`.          |
| `auth_methods` | string | No            | Auth methods: `"local"`, `"oidc"`, or `"local,oidc"`. Defaults to `"local"`. Any other value is rejected with `400`. |

**Example Request:**

```json
{
    "username": "jdoe",
    "password": "password123",
    "auth_methods": "local,oidc"
}
```

#### Response

```json
{ "status": "created" }
```

- **400** — invalid body, or `auth_methods` includes `local` without a `password`.
- **409** — username already exists.

### Update User

`PUT /api/v1/users/:userId`

**Description:** Updates an existing user's password or authentication methods.

#### Path Parameters

| Parameter | Type   | Required | Description                   |
| :-------- | :----- | :------- | :---------------------------- |
| `userId`  | string | **Yes**  | The ID of the user to update. |

#### Request Body

| Field          | Type   | Required | Description                                                     |
| :------------- | :----- | :------- | :-------------------------------------------------------------- |
| `password`     | string | No       | The new password. Only valid if user has `"local"` auth method. |
| `auth_methods` | string | No       | New comma-separated list of `local` and `oidc`. An empty string leaves the methods unchanged. |

#### Response

```json
{ "status": "updated" }
```

- **400** — invalid body, a `password` for a user without `local`, or `local` for a user who has no password and gets none.
- **404** — user not found.

### Delete User

`DELETE /api/v1/users/:userId`

**Description:** Deletes a user. Cannot delete yourself or the last remaining user.

#### Path Parameters

| Parameter | Type   | Required | Description                   |
| :-------- | :----- | :------- | :---------------------------- |
| `userId`  | string | **Yes**  | The ID of the user to delete. |

#### Response

```json
{ "status": "deleted" }
```

- **400** — `Cannot delete yourself` or `Cannot delete the last user`.
- **404** — user not found.

---

## 🖥️ Clients

### List Clients

`GET /api/v1/clients`

**Description:** Retrieves a list of all registered clients enriched with their live connection status from `ProxyService`.

#### Response (Array of Client objects)

| Field         | Type           | Description                                              |
| :------------ | :------------- | :------------------------------------------------------- |
| `id`          | string         | Client UUID.                                             |
| `hostname`    | string         | Hostname of the client machine.                          |
| `displayName` | string \| null | Optional human-readable name.                            |
| `site`        | string \| null | Network segment or location the operator put the client in. Part of the [cluster key](#list-clusters); `null` for none. |
| `status`      | string         | `"online"` or `"offline"`.                               |
| `lastSeen`    | string \| null | ISO 8601 timestamp of last connection.                   |
| `version`     | string \| null | Agent version reported on last connection.               |
| `connectionMode` | string      | `"inbound"` (agent dials in) or `"outbound"` (server dials the agent). |
| `inboundAllowedIp` | string \| null | Inbound clients: the address or IPv4 network connections must come from; `null` when the check is switched off. |
| `inboundLastIp` | string \| null | Inbound clients: the address the agent last authenticated from. Read-only and written only after the check above has passed, so it is always an address that was let in. The client editor measures a new `inboundAllowedIp` against it and warns before a value is saved that would refuse the agent. `null` until the agent has connected once. |
| `outboundTargetAddress` | string \| null | Outbound clients: `host:port` the server dials. |
| `capabilities` | string[] \| null | What the agent currently connected says it can do, as it named it in its `AUTH` payload (see below). `null` while the client is offline — capabilities belong to the build on the wire, not to the stored client; `[]` is a connected agent that names none. Current agents name `vrrp`. |
| `createdAt`   | string         | When the client was registered.                          |
| `updatedAt`   | string \| null | When the stored record last changed.                     |

**Example Response:**

```json
[
    {
        "id": "550e8400-e29b-41d4-a716-446655440000",
        "hostname": "lb-01",
        "displayName": "Load balancer 1",
        "site": null,
        "status": "online",
        "lastSeen": "2024-01-01T12:30:00.000Z",
        "version": "1.0.0",
        "connectionMode": "inbound",
        "inboundAllowedIp": "192.168.1.50",
        "inboundLastIp": "192.168.1.50",
        "outboundTargetAddress": null,
        "capabilities": ["vrrp"],
        "createdAt": "2024-01-01 10:00:00",
        "updatedAt": "2024-01-01 12:30:00"
    }
]
```

### Create Outbound Client

`POST /api/v1/clients/outbound`

**Description:** Adds a client that the **server** connects to (outbound mode), instead of the agent dialling in. The server opens `<scheme>://<outboundTargetAddress>/ws/register` — `wss://` when the stored address carries that prefix, `ws://` otherwise — hands over the agent's setup PIN (or its `KASM_REGISTRATION_SECRET`) together with a newly generated auth token and the client's server-issued `clientId` (stored by the agent in `identity.json` in its data directory), and then opens the regular agent session on `/ws/agent`, presenting both halves of that identity in the query string — the agent refuses a caller that does not name the id it was registered under. The client is written to the database only after that session has authenticated.

#### Request Body

| Field                   | Type   | Required | Description                                                          |
| :---------------------- | :----- | :------- | :------------------------------------------------------------------- |
| `outboundTargetAddress` | string | **Yes**  | `host`, `host:port` or `wss://host:port` of the agent's web server. Without a port, `:3011` is appended. `wss://` dials the agent over TLS, which requires the agent to serve it (see [client.md](client.md)); a bare address, or one written `ws://`, is stored and dialled as plaintext. Any other scheme, and a path, query or credentials, are refused — the value is interpolated into a WebSocket URL. |
| `registrationSecret`    | string | **Yes**  | The setup PIN from the agent's log, or the value of `KASM_REGISTRATION_SECRET` if the agent has one. The agent tells the two apart. |
| `hostname`              | string | No       | Name shown for the client. Defaults to `outboundTargetAddress`.      |

#### Response

```json
{ "id": "550e8400-e29b-41d4-a716-446655440000", "hostname": "lb-01" }
```

An empty `outboundTargetAddress` or `registrationSecret` is answered with `400` before any connection is attempted. On a failed handshake the endpoint answers `503` with `{ "error": "Could not establish connection to client. <reason>" }`. The reason is derived from how the agent ended the handshake, and the request returns as soon as the agent closes the connection:

| Agent response                                   | Reason given                                                                 |
| :----------------------------------------------- | :--------------------------------------------------------------------------- |
| Close `4003 Already registered`                  | The agent already holds an identity; delete its `identity.json`, restart it and use the new setup PIN. |
| Close `4003 No registration secret configured`   | Only from agents older than the setup PIN: they need `registrationSecret` in their `config.yaml`. |
| `REGISTRATION_FAILURE` / close `4003 Invalid secret` | Neither the setup PIN nor the secret matches. After 5 wrong attempts the agent logs a new PIN. |
| Close `4001 Registration timed out`              | The agent gave up waiting for the registration request.                      |
| Connection error / no answer within 10 s         | The underlying error, or a timeout message.                                  |
| Registration succeeded, AUTH failed              | The agent has already stored its token; it must be reset before retrying.   |

### Update Client

`PUT /api/v1/clients/:clientId`

**Description:** Updates a client's display name, for inbound clients the address its connections must come from, and for outbound clients the address the server dials. At least one field is required.

#### Path Parameters

| Parameter  | Type   | Required | Description             |
| :--------- | :----- | :------- | :---------------------- |
| `clientId` | string | **Yes**  | The UUID of the client. |

#### Request Body

| Field         | Type   | Required | Description                         |
| :------------ | :----- | :------- | :---------------------------------- |
| `displayName` | string | No       | The new display name for the client. |
| `site` | string \| null | No | At most 100 characters, trimmed. `null` or an empty string clears it; leaving the field out keeps the stored value. |
| `inboundAllowedIp` | string \| null | No | Inbound clients only. An IPv4 address or CIDR network restricts connections to it; `null` switches the check off; leaving the field out keeps the stored value. |
| `outboundTargetAddress` | string | No | Outbound clients only. `host` or `host:port` the server dials; without a port, `:3011` is appended. Same rule as on `POST /clients/outbound`. |

#### Response

```json
{ "success": true }
```

A changed `outboundTargetAddress` takes effect immediately: the open agent socket is closed, any pending reconnect is cancelled, and the new address is dialled at once rather than at the next backoff step. The reply does not wait for that attempt — an unreachable new address answers `200` and the client goes offline until a reconnect succeeds. Stored addresses are validated only when written, so a value saved before this check existed keeps working until it is edited.

- **400** — no field given, `inboundAllowedIp` not an IPv4 address or network, `inboundAllowedIp` sent for an outbound client, `outboundTargetAddress` sent for an inbound client, or `outboundTargetAddress` not a usable `host:port`.
- **404** — client not found.

### Delete Client

`DELETE /api/v1/clients/:clientId`

**Description:** Removes a client registration. If the client is currently connected, its WebSocket connection is terminated.

#### Path Parameters

| Parameter  | Type   | Required | Description                       |
| :--------- | :----- | :------- | :-------------------------------- |
| `clientId` | string | **Yes**  | The UUID of the client to delete. |

#### Response

```json
{ "status": "deleted" }
```

The client's last keepalived reading goes with it. For an outbound client any pending reconnect is cancelled first; an open agent socket is closed with `4000 Client deleted`. Nothing on the host is touched.

- **404** — client not found.

---

### Reconnect An Outbound Client

`POST /api/v1/clients/:clientId/reconnect`

**Description:** Dials an outbound client's agent again, now. Any open socket is closed and a pending backoff step is dropped, so the attempt starts from scratch rather than waiting out the ladder. The reply does not wait for the attempt: an unreachable agent answers `200` and the client stays offline until a later attempt succeeds. Inbound clients own their own reconnect ladder, so the route refuses them.

#### Path Parameters

| Parameter  | Type   | Required | Description             |
| :--------- | :----- | :------- | :---------------------- |
| `clientId` | string | **Yes**  | The UUID of the client. |

#### Response

```json
{ "status": "reconnecting" }
```

- **400** — the client is not an outbound client.
- **404** — no such client.

---

## 🎫 Registration Tokens

### List Tokens

`GET /api/v1/tokens`

**Description:** Lists all registration tokens including used and expired ones.

#### Response (Array of Token objects)

| Field              | Type           | Description                                     |
| :----------------- | :------------- | :---------------------------------------------- |
| `token`            | string         | The token string.                               |
| `createdAt`        | string         | Creation timestamp.                             |
| `expiresAt`        | string         | ISO 8601 expiry timestamp (30 min from creation). |
| `usedAt`           | string \| null | When a client registered with this token.       |
| `displayName`      | string \| null | Name the client will be created under, if the token carries one. |
| `inboundAllowedIp` | string \| null | Allowed address or network the client will start with, if the token carries one. |

The rows also carry the database columns under their own names (`created_at`, `expires_at`, `used_at`, `display_name`, `allowed_ip`); the dashboard reads the camelCase fields.

**Example Response:**

```json
[
    {
        "token": "a1b2c3d4e5f6...",
        "createdAt": "2024-01-01 10:00:00",
        "expiresAt": "2024-01-01T10:30:00.000Z",
        "usedAt": null,
        "displayName": "lb-02",
        "inboundAllowedIp": "192.168.1.0/24"
    }
]
```

### Create Token

`POST /api/v1/tokens`

**Description:** Generates a new short-lived registration token (valid for 30 minutes), optionally carrying what the registering agent cannot tell the server about itself.

#### Request Body

The body is optional; a request without one behaves as it always did.

| Field              | Type   | Required | Description                                                                                     |
| :----------------- | :----- | :------- | :---------------------------------------------------------------------------------------------- |
| `displayName`      | string | No       | Name the client is created under. Without it the hostname the agent reports is used.            |
| `inboundAllowedIp` | string | No       | IPv4 address or CIDR network the client is restricted to. Without it the address the agent registers from is used. |

#### Response

```json
{
    "token": "a1b2c3d4e5...",
    "expiresAt": "2024-01-01T10:30:00.000Z",
    "displayName": "lb-02",
    "inboundAllowedIp": "192.168.1.0/24"
}
```

- **400** — `displayName` longer than 100 characters, or `inboundAllowedIp` not an IPv4 address or network.

Both defaults are stored with the token and applied by `POST /api/v1/register`. Tokens issued before these fields existed carry neither and keep behaving as they did.

### Delete Token

`DELETE /api/v1/tokens/:token`

**Description:** Manually invalidates and deletes a registration token.

#### Path Parameters

| Parameter | Type   | Required | Description                 |
| :-------- | :----- | :------- | :-------------------------- |
| `token`   | string | **Yes**  | The token string to delete. |

#### Response

```json
{ "status": "deleted" }
```

A token that does not exist answers `404` with `{ "error": "Token not found" }`.

### Register Client (Public)

`POST /api/v1/register`

**Description:** Public endpoint used by the client agent to register itself using a valid token. Returns the client's identity: a `clientId` and a permanent `authToken` for subsequent WebSocket connections. Both are issued by the **server**; every successful call creates a new client.

#### Request Body

| Field      | Type   | Required | Description                                     |
| :--------- | :----- | :------- | :---------------------------------------------- |
| `token`    | string | **Yes**  | A valid, unused, and non-expired registration token. |
| `hostname` | string | No       | Hostname of the client device. Stored as `unknown` when missing. |

A body without a `token` is answered with `400`, before the token is looked up. An unknown, used or expired token gets `403`.

A `clientId` in the body, as sent by older agents, is ignored. It used to be taken over and
upserted, which let anyone holding a registration token name an existing client and replace its
auth token.

**Example Request:**

```json
{
    "token": "a1b2c3d4e5...",
    "hostname": "lb-02"
}
```

#### Response

```json
{
    "token": "f8a9b2...",
    "clientId": "550e8400-e29b-41d4-a716-446655440000"
}
```

> The returned `token` is the permanent `authToken` and `clientId` the id the server knows the client by. The agent saves both in `identity.json` in its data directory; the `token` is used for all future WebSocket connections.
>
> Registering an agent again creates a **new** client entry; the previous one stays behind offline and can be deleted in the UI.
>
> The new client's display name and allowed address come from the token when it carries them (see `POST /api/v1/tokens`). Otherwise the agent's reported hostname names it and the address it registered from becomes its allowed address, which is what a token without defaults does.

---

## 📡 keepalived

What the agents read out of keepalived. The readings arrive over the agent WebSocket
(`KEEPALIVED_UPDATE`), are stored per client and pushed to the dashboards; these endpoints
return what is stored.

### List Readings

`GET /api/v1/keepalived/states`

**Description:** The last reading of every client that has sent one, offline clients
included — what a host last reported is still worth showing, and its client's `status` says
how current it is.

#### Response (Array of KeepalivedState objects)

| Field | Type | Description |
| :---- | :--- | :---------- |
| `clientId` | string | The client the reading belongs to. |
| `receivedAt` | string | When the server received it. |
| `collectedAt` | string | When the agent took it, by the agent's clock. |
| `running` | boolean | Whether a keepalived process was found. `false` is a valid reading and carries no instances. |
| `pid` | number \| null | keepalived's parent process. |
| `version` | string \| null | keepalived's version, read from its binary. |
| `source` | `"data"` \| `"json"` \| null | Which dump the instances come from. |
| `error` | string \| null | Why a running keepalived could not be read, e.g. a missing capability. |
| `instances` | VrrpInstance[] | See below. |
| `syncGroups` | `{ name, state, instances: string[] }[]` | VRRP sync groups. |

**VrrpInstance:**

| Field | Type | Description |
| :---- | :--- | :---------- |
| `name` | string | The `vrrp_instance` name. |
| `state` | string | `INIT`, `BACKUP`, `MASTER`, `FAULT`, `STOP`, `DELETED`, or `UNKNOWN` for a word this build does not know. |
| `wantedState` | string \| null | The state the configuration asks for (`state MASTER\|BACKUP`). |
| `interface` | string \| null | The interface the instance runs on. |
| `vrid` | number \| null | `virtual_router_id`. |
| `priority` / `effectivePriority` | number \| null | Configured priority, and the priority after track scripts and interfaces. |
| `advertInterval` | number \| null | Seconds between advertisements. |
| `vips` | string[] | Virtual addresses, with prefix length where keepalived gives one. |
| `syncGroup` | string \| null | The sync group the instance belongs to. |
| `lastTransition` | string \| null | When the instance last changed state, from keepalived. |
| `stats` | object \| null | keepalived's counters, keyed in snake case: `advertisements_received`, `advertisements_sent`, `became_master`, `released_master`, `priority_zero_received`, … |

```json
[
    {
        "clientId": "550e8400-e29b-41d4-a716-446655440000",
        "receivedAt": "2026-09-19T10:54:26.301Z",
        "collectedAt": "2026-09-19T10:54:26.280Z",
        "running": true,
        "pid": 812,
        "version": "2.2.8",
        "source": "data",
        "error": null,
        "instances": [
            {
                "name": "VI_WEB",
                "state": "MASTER",
                "wantedState": "MASTER",
                "interface": "eth0",
                "vrid": 51,
                "priority": 150,
                "effectivePriority": 150,
                "advertInterval": 1,
                "vips": ["192.168.1.100/24"],
                "syncGroup": "VG_1",
                "lastTransition": "2026-09-19T10:54:26.112Z",
                "stats": { "advertisements_sent": 1234, "became_master": 1 }
            }
        ],
        "syncGroups": [{ "name": "VG_1", "state": "MASTER", "instances": ["VI_WEB"] }]
    }
]
```

### List Clusters

`GET /api/v1/keepalived/clusters`

**Description:** The instances of all clients, grouped by the virtual router they answer
for: same client `site`, same VRID, and a **shared network**. A VRID is unique per broadcast
domain only, so the network the virtual addresses sit on is what tells two otherwise equal
clusters apart — `192.168.1.100/24` belongs to `192.168.1.0/24`, and an address written
without a prefix is the host route keepalived makes of it (`/32`), which matches only
itself. Instances whose networks overlap are one cluster, transitively; an instance that
reports no address at all is grouped by VRID and instance name. Two sites that use the same
VRID *and* the same private network are told apart by the site only — every member of a
cluster needs the same one, and clients without a site share the empty one. The grouping is
`buildVrrpClusters` from `@kasm/shared`, the same function the dashboard runs.

The virtual addresses are deliberately **not** part of the identity. They are what this
tool watches, so a cluster whose identity changed with them could never report that its
hosts disagree about them — see `vip-mismatch` below. `vips` is therefore the union of what
the members carry, and `key` is `<site>|<vrid>|<network>`.

```json
[
    {
        "key": "|51|192.168.1.0/24",
        "site": null,
        "vrid": 51,
        "networks": ["192.168.1.0/24"],
        "vips": ["192.168.1.100/24"],
        "health": "degraded",
        "members": [
            { "clientId": "550e…", "online": true, "instance": { "name": "VI_WEB", "state": "MASTER", "…": "…" } },
            { "clientId": "7c1a…", "online": true, "instance": { "name": "VI_WEB", "state": "FAULT", "…": "…" } }
        ]
    }
]
```

`health` is counted over online members only — an offline member's state is its last
report, not its present one:

| `health` | Means |
| :------- | :---- |
| `split-brain` | More than one online member is MASTER. |
| `no-master` | Online members exist, none is MASTER. |
| `vip-mismatch` | The members do not all carry the same virtual addresses, so a failover changes which of them are up. The one value counted over **every** member, offline included: it describes the configuration, not the state. An outage above keeps its place. |
| `degraded` | One MASTER, but a member is in FAULT, offline, or the only member. |
| `unknown` | No member is online. |
| `ok` | One MASTER, every member online and none in FAULT. |

Ordered with the clusters that need attention first.

### Get A Client's Reading

`GET /api/v1/clients/:clientId/keepalived`

**Description:** One client's last reading, as in [List Readings](#list-readings).

- **404** — client not found, or it has not sent a reading yet.

### Refresh A Client's Reading

`POST /api/v1/clients/:clientId/keepalived/refresh`

**Description:** Asks the agent to read keepalived now (`REQUEST_STATE_UPDATE`). The
reading arrives over the dashboard WebSocket like any other; the reply only says that the
agent was asked.

```json
{ "status": "requested" }
```

- **404** — client not found.
- **409** — the client is offline.

---

## 🛠️ Settings & Maintenance

### Get Settings

`GET /api/v1/settings/cleanup`

**Description:** Retrieves the `settings` block of `config.yaml`, every default filled in. The known values are returned as strings; a key added to the file by hand comes back as YAML read it. The `security` block is not part of the response: it is configured in `config.yaml` only.

#### Response

The defaults:

```json
{
    "retention_invalid_tokens_days": "30",
    "retention_invalid_tokens_count": "10",
    "notification_retention_days": "90",
    "notification_retention_count": "500",
    "notification_cleanup_interval_hours": "24"
}
```

| Setting                                      | Description                                                                   |
| :------------------------------------------- | :---------------------------------------------------------------------------- |
| `retention_invalid_tokens_days`              | Days to retain used/expired registration tokens before they become eligible for deletion. `"0"` deletes immediately. |
| `retention_invalid_tokens_count`             | Minimum number of most-recent invalid tokens to always keep (audit trail).    |
| `notification_retention_days`                | Days to keep activity events, measured against `occurredAt`. `"0"` is not "forever": it falls back to `90`. |
| `notification_retention_count`               | Minimum number of the newest activity events always kept.                     |
| `notification_cleanup_interval_hours`        | Interval of the automatic activity cleanup. `"0"` disables the scheduler.     |

The `notification_*` names are kept from the project KASM started from, because the settings page still calls the list "Notification History".

### Update Settings

`PUT /api/v1/settings/cleanup`

**Description:** Updates settings. All fields are optional; only provided fields are updated.

#### Request Body

Pass any of the setting keys to update them.

```json
{
    "retention_invalid_tokens_days": "60",
    "notification_retention_days": "30"
}
```

| Kind of setting | Keys | Accepted values |
| :-------------- | :--- | :-------------- |
| Counts, days, intervals | `retention_invalid_tokens_*`, `notification_*` | A non-negative whole number, as string or number. Stored as string. |

Keys not listed are accepted and written as they are: the settings page sends back everything it read, including keys an operator added to `config.yaml` by hand, and rejecting or dropping them would delete them from the file.

#### Response

```json
{ "success": true }
```

- **400** — a value does not match the table above, or the body contains `security`. Network and HSTS settings are configured in `config.yaml` only; a session token must not be enough to lock every agent out.

> A changed value takes effect without a restart: `notification_*` restarts the `NotificationCleanupService` scheduler.

### Run Invalid Token Cleanup

`POST /api/v1/settings/cleanup/invalid-tokens`

**Description:** Runs `TokenCleanupService` synchronously, removing used/expired registration tokens older than `retention_invalid_tokens_days` while keeping at least `retention_invalid_tokens_count` of the most-recent ones.

#### Response

```json
{ "success": true, "removed": 4 }
```

### Run Activity Cleanup

`POST /api/v1/settings/cleanup/notifications`

**Description:** Runs `NotificationCleanupService` synchronously, applying the retention policy to the activity table. The path keeps the old name, as the dashboard page does; what it prunes is the activity list.

#### Response

```json
{ "success": true, "removed": 12 }
```

---

### Scheduler Status

`GET /api/v1/settings/scheduler-status`

**Description:** Returns the current status of the schedulers the server itself runs.

#### Response

```json
{
    "notificationCleanupLastRun": "2026-04-18T04:00:00.000Z"
}
```

---

## 📣 Activity

Everything that happened, as its originator reported it. The dashboard still calls the page
"Notifications"; the domain does not.

An event carries no message. It carries a `kind`, a `level`, what it is about and the facts
of that kind — the old and the new VRRP state, a priority, an error — and the text is composed in
the frontend out of those. That is what lets an agent of an older version stay useful: it
reports the same facts and how they are worded is not its business. It also means filtering
by `kind` and `level` is exact rather than a search through prose.

`level` is one of `trace`, `info`, `warning` and `error`, lowest first. `trace` marks routine
bookkeeping — an agent connecting or disconnecting — which the dashboard hides by default.
A level this build does not know is read as `info`.

`kind` is **not** a closed set on the wire. An agent of another version may report a kind
this server does not know; it is stored as it is, and the dashboard falls back to printing
the kind itself rather than dropping an observation nobody can make again.

Two timestamps, and the difference matters. `occurredAt` is the originator's clock and
orders the list; `receivedAt` is the server's. After an offline stretch an event from 03:00
arrives at 08:00: it belongs at 03:00 in the list, while the seen state is per event, so a
late arrival cannot slip in under entries a user has already worked through. The gap between
the two also exposes an agent whose clock is wrong.

`occurredAt` of a `vrrp.state_changed` is keepalived's own `Last transition`, not the time
the agent happened to read it.

| Kind | Source | Level | `data` |
| :--- | :----- | :---- | :----- |
| `vrrp.state_changed` | agent | `error` to FAULT, `warning` from MASTER, else `info` | `from`, `to`, `priority`, `effectivePriority` |
| `vrrp.instance_added` / `vrrp.instance_removed` | agent | `info` | `state` |
| `keepalived.started` / `keepalived.stopped` | agent | `info` / `warning` | `pid`, `version` |
| `keepalived.unreadable` | agent | `error` | `error` |
| `client.connected` / `client.disconnected` | server | `trace` | `connectionMode`, `version`, `clientName` |
| `client.registered` | server | `info` | `hostname`, `clientName` |

`subject` of the agent's VRRP events is `{ instanceName, vrid, interface }`.
`correlationId` groups events that belong together; none of the kinds above uses it yet.

### List Activity

`GET /api/v1/activity`

**Response:**

```json
[
    {
        "id": "d3f1…",
        "occurredAt": "2026-09-13T03:00:07.412Z",
        "receivedAt": "2026-09-13T08:14:02.900Z",
        "source": "agent",
        "clientId": "…",
        "kind": "vrrp.state_changed",
        "level": "warning",
        "correlationId": null,
        "subject": {
            "instanceName": "VI_WEB",
            "vrid": 51,
            "interface": "eth0"
        },
        "data": { "from": "MASTER", "to": "BACKUP", "priority": 100, "effectivePriority": 100 },
        "seenBy": [1]
    }
]
```

Newest first by `occurredAt`.

### Mark Seen

`POST /api/v1/activity/:id/seen` marks one event seen by the calling user;
`POST /api/v1/activity/seen-all` marks every event seen. Both answer `{ "ok": true }`;
the first answers `404` for an id that is not there.

### Delete Activity

`DELETE /api/v1/activity/:id` removes one event, `DELETE /api/v1/activity` removes all of
them. Both answer `{ "ok": true }`; the first answers `404` for an id that is not there.

Retention runs on its own through `notification_retention_days` and
`notification_retention_count` — the page they are set on is called "Notification History".

Every mutating endpoint broadcasts `ACTIVITY_UPDATE` with the full list.

---

## 🏓 Misc

### Health

`GET /api/health` (no `/v1` prefix)

**Description:** Liveness probe, used by the image's `HEALTHCHECK` and the CI smoke test. No authentication — a probe has no session, and the answer discloses nothing.

| Status | Body                 | Meaning                                                   |
| :----- | :------------------- | :-------------------------------------------------------- |
| `200`  | `{"status":"ok"}`    | The process serves requests and its database is reachable |
| `503`  | `{"status":"error"}` | The database could not be queried                         |

Agent connections are not consulted: one offline agent must not mark the control plane as broken. The agent's web UI has its own `GET /api/health` on port 3011, which reports only that the agent process answers — not whether it is connected to the server. It serves the container's `HEALTHCHECK` alone: it exists only in the container image and answers only loopback, everyone else gets `404`.

**Why under `/api`:** the server answers every path outside `/api` with the dashboard's `index.html` and HTTP `200`, so a probe on `/health` would report success even without the route. Under `/api`, an unknown path is a `404`.

### Reachability

`GET /api/v1/ping`

**Description:** Answers "is there a KASM server at this URL?". The agent's web UI calls it for an address an operator has just typed. It deliberately checks nothing else: a server with a broken database is still reachable, and reporting otherwise during setup would point at the wrong problem. For "can this instance serve requests", use [Health](#health).

#### Response

```json
{ "status": "ok" }
```

---

## 🔌 WebSockets

### Dashboard Connection

`GET /ws/dashboard`

**Description:** WebSocket endpoint for the web dashboard to receive real-time client status updates.

#### Authentication

The `kasm_session` cookie, which the browser sends with the handshake by itself. A `token` query parameter is no longer accepted. Without the cookie the server closes with `4001 Unauthorized`, with an invalid or expired token with `4001 Invalid Token`.

#### Behavior

- On connect: The server immediately sends a `CLIENTS_UPDATE` with the full client list, then one `KEEPALIVED_STATE_UPDATE` per client that has a stored reading, then an `ACTIVITY_UPDATE` with the activity list. A dashboard therefore needs no REST call to fill its first screen.
- A ping/pong heartbeat runs every 30 seconds to detect dead connections.
- All broadcasts from `ProxyService` (e.g., agent connects/disconnects) are forwarded to all active dashboard sessions.

#### Events (Server -> Client)

| Event                 | Payload                                     | Description                                                       |
| :-------------------- | :------------------------------------------ | :---------------------------------------------------------------- |
| `CLIENTS_UPDATE`      | `Client[]`                                  | Full list of all clients and their statuses.                      |
| `KEEPALIVED_STATE_UPDATE` | `KeepalivedState`                       | One client's reading, as in [List Readings](#list-readings). The dashboard recomputes the clusters from these. |
| `ACTIVITY_UPDATE`     | `ActivityRecord[]`                          | The activity list, after an event arrived or the seen state changed. |

---

### Agent Connection

`GET /ws/agent`

**Description:** WebSocket endpoint for client agents. Requires the identity issued during registration — the `clientId` and the `authToken` together.

#### Query Parameters

| Parameter  | Type   | Required | Description                                                  |
| :--------- | :----- | :------- | :----------------------------------------------------------- |
| `clientId` | string | **Yes**  | The server-issued `clientId` from the client's `config.yaml`. |
| `token`    | string | **Yes**  | The permanent `authToken` from the client's `identity.json`.  |

A request missing either half is closed with `4001 Authentication required`. The token may
also be sent as `Authorization: Bearer <token>`; the id has no header form.

#### Authentication Stages

1. Id and token are looked up as a pair — both have to name the same row (`4003 Invalid credentials` otherwise). The id alone is no secret, and a token alone used to make a client whoever its token happened to belong to.
2. Client's IP is checked against `security.allowed_networks` (`4003 Access denied`).
3. A token that belongs to an **outbound** client is refused (`4003 Access denied`): those are dialled by the server and never connect here.
4. Client's IP is checked against the client's allowed address or network; a client whose check is switched off skips this step (`4003 IP address mismatch`).
5. A 5-second window is given for the client to send an `AUTH` handshake message (`4001 Authentication timed out` otherwise). An `AUTH` whose payload does not parse is closed with `4000 Invalid payload`; any other first message is answered with `AUTH_FAILURE` and closed with `4003 Forbidden`.

A second connection under the same client id replaces the first, which is closed with `4000 Replaced by new connection`.

#### Client -> Server Events

**`AUTH`**
**Description:** Initial handshake, sent immediately after connection.
**Payload:**

```json
{
    "hostname": "client-hostname",
    "version": "1.0.0",
    "capabilities": ["vrrp"]
}
```

`capabilities` says what this agent's build can do (currently `vrrp`: it reads VRRP instances
and sync groups); a missing field is read as an empty list. The server reads it by asking
whether an entry is in the list, never by exhausting it, so a newer agent may name something
this server has never heard of.

**`KEEPALIVED_UPDATE`**
**Description:** One reading of keepalived. Sent right after `AUTH_SUCCESS`, whenever a reading differs from the last one sent (counters aside), at least every 30 seconds, and on `REQUEST_STATE_UPDATE`.
**Payload:** `KeepalivedState` without `clientId` and `receivedAt` — see [List Readings](#list-readings). The server parses it against `KeepalivedStatusSchema` and discards one that does not fit; fields it does not know are kept. An unknown state word becomes `UNKNOWN` instead of refusing the reading.

**`ACTIVITY`**
**Description:** Events the agent has observed and has not had acknowledged yet. Sent as they happen while connected, and as a batch on every reconnect. A batch, not one message per event: an agent that was offline has a queue to hand over.
**Payload:**

```json
{ "events": [ { "id": "…", "occurredAt": "…", "kind": "vrrp.state_changed", "level": "warning", "correlationId": null, "subject": { }, "data": { } } ] }
```

`source` and `clientId` are taken from the connection, not from the payload — an agent may only ever speak about itself. Delivery is **at-least-once**: the event keeps its id until the server acknowledges it, and the primary key makes a second copy a no-op.

The events are parsed one by one. A batch whose envelope does not parse (no `events` array) is dropped **without** an ack, so the agent keeps offering it. A single event that does not parse but carries an id is the exception: it is **acknowledged without being stored** and logged. Offering it again would change nothing, and because the agent hands its queue over in order, it would block every event behind it. An unparsable event without an id is simply dropped.

#### Server -> Client Events

**`AUTH_SUCCESS`**
**Payload:**

```json
{
    "lastSyncTime": null
}
```

`lastSyncTime` is always `null`; nothing reads it.

**`AUTH_FAILURE`**
**Description:** Sent when the first message of an inbound connection is not `AUTH`, directly before the socket is closed with `4003 Forbidden`. Every other refusal is a close code alone (see [Authentication Stages](#authentication-stages)).
**Payload:** `{}`

**`REQUEST_STATE_UPDATE`**
**Description:** Asks the agent to read keepalived now and send a `KEEPALIVED_UPDATE`, whether or not it changed.
**Payload:** `{}`

**`ACTIVITY_ACK`**
**Description:** The ids the server has stored. The agent drops them from its queue; ids it does not name stay and are offered again.
**Payload:** `{ "ids": ["…"] }`

> After a successful `AUTH` / `AUTH_SUCCESS` exchange, the server registers the client in `ProxyService` and broadcasts a `CLIENTS_UPDATE` to all connected dashboards.
