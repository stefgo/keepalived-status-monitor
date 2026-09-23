import { z } from "zod";
import {
    ACTIVITY_LEVELS,
    ACTIVITY_SOURCES,
    CLIENT_STATUS,
    CONNECTION_MODE,
    DEFAULT_AGENT_PORT,
    SCHEDULER_IDS,
    SCHEDULER_RUN_STATUSES,
    SCHEDULER_TRIGGERS,
    VRRP_STATES,
    WS_EVENTS,
} from "./constants.js";
import { normaliseTargetAddress } from "./targetAddress.js";

/**
 * A single IPv4 address or an IPv4 network in CIDR notation. IPv4 only: addresses are
 * matched by the 32-bit comparison in network.ts, which cannot evaluate an IPv6 value.
 */
export const Ipv4OrCidrSchema = z.union([z.ipv4(), z.cidrv4()], {
    error: "Must be an IPv4 address or an IPv4 network in CIDR notation",
});

/** YAML turns an empty block (`settings:` with nothing below it) into null. */
const blockOrMissing = <T extends z.ZodType>(schema: T) =>
    z.preprocess((value) => value ?? undefined, schema);

/** The levels pino accepts, for both config files. */
export const LogLevelSchema = z.enum([
    "trace",
    "debug",
    "info",
    "warn",
    "error",
    "fatal",
    "silent",
]);

/**
 * The agent's `keepalived` block in its config.yaml: what makes it read keepalived and where
 * keepalived writes its dumps. The paths are as keepalived sees them -- the agent reads them
 * through `/proc/<pid>/root`, which is what makes a systemd `PrivateTmp=true` transparent.
 *
 * Three things can start a reading, and each is switched on by its own key: the timer
 * (`pollInterval`), the notify FIFO (`notifyFifo`) and the notify endpoint (`notifyToken`).
 * The last two only trigger a reading; the data always comes from the dumps.
 */
export const AgentKeepalivedConfigSchema = z
    .object({
        /** Seconds between two readings; 0 switches the timer off. */
        pollInterval: z
            .number()
            .min(0)
            .max(3600)
            .refine((value) => value === 0 || value >= 1, {
                error: "Must be 0 (off) or at least 1 second",
            })
            .default(5),
        /**
         * keepalived's `vrrp_notify_fifo`, as keepalived sees it. Every line keepalived writes
         * there triggers a reading. Unset leaves the FIFO alone -- it has one reader only, and
         * that may be somebody else's.
         */
        notifyFifo: z.string().startsWith("/").nullish(),
        /**
         * The bearer token `POST /api/keepalived/notify` expects, which a keepalived notify
         * script calls. Unset means the route does not exist.
         */
        notifyToken: z.string().min(16).nullish(),
        dataFile: z.string().startsWith("/").default("/tmp/keepalived.data"),
        statsFile: z.string().startsWith("/").default("/tmp/keepalived.stats"),
        jsonFile: z.string().startsWith("/").default("/tmp/keepalived.json"),
        /**
         * The number keepalived answers to `keepalived --signum=JSON`. Unset reads the text
         * dump; the JSON dump exists only when keepalived was built with `--enable-json`.
         */
        jsonSignal: z.number().int().min(1).max(64).nullish(),
        /** How long to wait for keepalived to write a dump after the signal. */
        dumpTimeoutMs: z.number().int().min(100).max(30000).default(3000),
    })
    .superRefine((value, ctx) => {
        if (value.pollInterval === 0 && !value.notifyFifo && !value.notifyToken) {
            ctx.addIssue({
                code: "custom",
                path: ["pollInterval"],
                message:
                    "0 switches the timer off, but neither notifyFifo nor notifyToken is set -- nothing would ever read keepalived",
            });
        }
    })
    .prefault({});

/**
 * Where the certificate and its private key are, for an agent that terminates TLS. The
 * paths stay exactly as the operator wrote them -- the agent resolves them against its own
 * directory and checks at startup that both files can be read.
 */
export const AgentTlsConfigSchema = z.object({
    cert: z.string().trim().min(1, { error: "Must be the path to a certificate file" }),
    key: z.string().trim().min(1, { error: "Must be the path to a private key file" }),
});

/**
 * The whole of the agent's config.yaml -- everything the operator writes, and nothing the
 * agent writes back: `clientId` and `authToken` are issued by the server and live in the
 * agent's data directory (see client/src/core/Identity.ts).
 *
 * Loose at the top level, so a key this version does not know stays a key it ignores rather
 * than a reason not to start. The agent edits the file through its YAML document, never by
 * writing this object back, so nothing here can delete what it did not parse.
 *
 * Every field carries its default, which makes this schema the one place that says what an
 * agent without a config.yaml does. Two settings are deliberately *not* validated here --
 * `logLevel` and `allowSelfSignedCertificates` are tolerated rather than fatal, and Config.ts
 * drops a wrong value with a warning before it reaches this schema.
 */
export const AgentConfigSchema = z.looseObject({
    /**
     * Where the server is, for an agent that dials in. Left unvalidated beyond "a
     * non-empty string": a URL nobody can parse costs the WebSocket, not the web UI the
     * operator would fix it in -- so it is a warning at derivation, not a refusal to start.
     */
    serverUrl: z.string().trim().min(1).nullish(),
    logLevel: LogLevelSchema.default("info"),
    /** Where and how often keepalived is read. */
    keepalived: blockOrMissing(AgentKeepalivedConfigSchema),
    enableStatusPage: z.boolean().default(true),
    enableRegisterPage: z.boolean().default(true),
    /**
     * Networks the server may dial `/ws/register` and `/ws/agent` from. Empty means no
     * restriction, as before the setting existed. The local web UI on the same port is
     * deliberately not covered: it is where an operator registers the agent, and a list
     * holding only the server's address would shut them out of it.
     */
    allowedNetworks: z.array(Ipv4OrCidrSchema).default([]),
    /**
     * The port the local web server listens on. Coerced, because `KASM_CLIENT_PORT` is laid
     * over this field as a string. A value that is not a port is refused rather than
     * silently replaced by the default: an agent listening somewhere other than where its
     * operator put it is the harder fault to find. Port 0 -- "any free port" to Node -- is
     * never what this setting means, and the minimum rules it out.
     */
    listenPort: z.coerce
        .number({ error: "Must be an integer between 1 and 65535" })
        .int({ error: "Must be an integer between 1 and 65535" })
        .min(1)
        .max(65535)
        .default(DEFAULT_AGENT_PORT),
    /**
     * Accept a server certificate that does not validate, for registration and for the
     * WebSocket alike. Off by default: that WebSocket carries the auth token, and a
     * certificate nobody checks is one anybody in between can present.
     */
    allowSelfSignedCertificates: z.boolean().default(false),
    /**
     * Serve the agent's own web server over TLS. Absent means plain HTTP, which is what
     * every installation had before this existed. The other half of
     * `allowSelfSignedCertificates`: that one is about the certificate this agent checks
     * when it dials the server, this one about the certificate it presents when the server
     * dials it.
     */
    tls: blockOrMissing(AgentTlsConfigSchema.optional()),
});

export type AgentConfigParsed = z.output<typeof AgentConfigSchema>;

/** The identity the server issues at registration, as the agent stores it. */
export const AgentIdentitySchema = z.object({
    clientId: z.string().min(1),
    authToken: z.string().min(1),
});

export const ClientSchema = z.object({
    id: z.uuid(),
    hostname: z.string(),
    /**
     * Nullish, not optional: `display_name`, `version` and `last_seen` are nullable columns,
     * and the server hands their value through as it reads it. A client that has never
     * connected carries `lastSeen: null`.
     */
    displayName: z.string().nullish(),
    /**
     * The network segment or location the operator put this client in. Part of the VRRP
     * cluster key: a VRID is unique only per segment, so hosts at two sites may use the same
     * one. Null means no site, which every client without one shares.
     */
    site: z.string().nullish(),
    status: z.enum(CLIENT_STATUS),
    lastSeen: z.string().nullish(),
    version: z.string().nullish(),
    connectionMode: z.enum(CONNECTION_MODE).optional(),
    /**
     * Inbound clients only: the address or network their connections must come from, or
     * null when the check is switched off. A plain string here, not Ipv4OrCidrSchema: a
     * client registered from an IPv6 address stores that address.
     */
    inboundAllowedIp: z.string().nullish(),
    /**
     * Inbound clients only: the address the agent last authenticated from. Nothing decides
     * on it -- the server writes it only once the allowed-address check has passed, so it is
     * always an address that was let in. It is here so the client editor can say what
     * `inboundAllowedIp` is about to be measured against, and warn before a value is saved
     * that would refuse the agent at its next reconnect. Not part of UpdateClient: the
     * server observes this, the operator does not set it.
     */
    inboundLastIp: z.string().nullish(),
    outboundTargetAddress: z.string().nullish(),
    /**
     * What the agent on the wire right now says it can do, as it named it in its AUTH
     * payload. `null` while the client is offline: capabilities describe the build that is
     * connected, and an agent updated while it was away must not be credited with what its
     * predecessor could do. An empty list is the other answer entirely -- a connected agent
     * that names nothing. Observed, never set -- hence not part of UpdateClient.
     */
    capabilities: z.array(z.string()).nullish(),
});

/**
 * What an agent sends to `POST /api/v1/register`. It brings no identity of its own: the
 * server issues both `clientId` and the auth token and returns them below.
 */
export const RegistrationPayloadSchema = z.object({
    token: z.string().min(1),
    hostname: z.string().optional(),
});

/** The identity the server issues. The agent stores both values in its config.yaml. */
export const RegistrationResponseSchema = z.object({
    token: z.string(),
    clientId: z.string(),
});

/** A registration token as the list shows it: by its hash, never the token itself. */
export const TokenSchema = z.object({
    /** SHA-256 of the token, hex. Also what `DELETE /api/v1/tokens/:tokenHash` takes. */
    tokenHash: z.string(),
    createdAt: z.string(),
    expiresAt: z.string(),
    usedAt: z.string().optional(),
    /**
     * What the operator fixed when issuing the token, for the client it creates. Absent
     * means the agent's hostname and the address it registers from decide, as before.
     */
    displayName: z.string().nullish(),
    inboundAllowedIp: z.string().nullish(),
});

/**
 * `POST /api/v1/tokens`: the one response that carries the token in the clear. The server
 * stores only its hash, so this is the only time it can be shown.
 */
export const CreatedTokenSchema = z.object({
    token: z.string(),
    expiresAt: z.string(),
    displayName: z.string().nullish(),
    inboundAllowedIp: z.string().nullish(),
});

// WS Payloads schemas

export const AuthPayloadSchema = z.object({
    hostname: z.string(),
    version: z.string().optional(),
    /**
     * What this agent can do, from `AGENT_CAPABILITIES`. Plain strings rather than an enum:
     * an agent of a newer build may name something this server has never heard of, and the
     * list is read by asking whether an entry is in it, never by exhausting it. An agent
     * that predates the field sends none, which is the honest answer for it.
     */
    capabilities: z.array(z.string()).default([]),
});

// REST request bodies
//
// What the HTTP endpoints accept. They exist for the same reason the WebSocket schemas do: an
// unchecked body reaches a repository or the config file unaltered.
// They live here rather than in the backend so the frontend can derive its types from them.

/** `POST /api/login`. An empty field is a malformed request, not a failed login. */
export const LoginPayloadSchema = z.object({
    username: z.string().min(1),
    password: z.string().min(1),
});

/**
 * A comma-separated list of `local` and `oidc`. The empty string is accepted because the
 * user dialog sends it when no box is ticked, and the controllers read it as "not given".
 */
const AuthMethodsSchema = z
    .string()
    .regex(
        /^((local|oidc)(,(local|oidc))*)?$/,
        'Must be a comma-separated list of "local" and "oidc"',
    );

/**
 * `POST /api/v1/users`. `password` is optional here because an OIDC-only user has none; that
 * a local user needs one is a rule about the combination, checked by the controller.
 */
export const CreateUserSchema = z.object({
    username: z.string().trim().min(1).max(100),
    password: z.string().min(1).optional(),
    auth_methods: AuthMethodsSchema.optional(),
});

/** `PUT /api/v1/users/:userId`. Either field alone is a valid edit. */
export const UpdateUserSchema = z.object({
    password: z.string().min(1).optional(),
    auth_methods: AuthMethodsSchema.optional(),
});

/**
 * Where the server dials an outbound agent, as `host:port`. Transformed rather than only
 * checked, so what reaches the database is the normalised form: the value is interpolated
 * into a `ws://` URL, and a scheme, path or credentials in it would quietly send the agent
 * connection elsewhere.
 */
export const TargetAddressSchema = z
    .string()
    .transform((value) => normaliseTargetAddress(value))
    .refine((address): address is string => address !== null, {
        error: "Must be a host or host:port, without scheme, path or credentials",
    });

/**
 * `POST /api/v1/tokens`. Both fields are optional: a token without them behaves as every
 * token did before they existed -- the agent's hostname names the client, and the address
 * it registers from becomes its allowed address.
 */
export const CreateTokenSchema = z.object({
    displayName: z.string().trim().max(100).optional(),
    inboundAllowedIp: Ipv4OrCidrSchema.optional(),
});

/** `POST /api/v1/clients/outbound`. */
export const CreateOutboundClientSchema = z.object({
    outboundTargetAddress: TargetAddressSchema,
    /**
     * What the server presents on the agent's `/ws/register`: the setup PIN from the agent's
     * log, or the agent's `KASM_REGISTRATION_SECRET`. The agent tells the two apart itself.
     */
    registrationSecret: z.string().min(1),
    hostname: z.string().optional(),
});

/**
 * `PUT /api/v1/clients/:clientId`. Every field is optional, but at least one has to be there.
 *
 * `inboundAllowedIp` has three states on the wire: a value restricts, `null` switches the
 * check off, and an absent key leaves the stored value alone.
 *
 * `outboundTargetAddress` applies to outbound clients only; the controller refuses it for
 * an inbound one, the way it refuses `inboundAllowedIp` for an outbound one.
 *
 * `site`: `null` or an empty string clears it, an absent key leaves it alone.
 */
export const UpdateClientSchema = z
    .object({
        displayName: z.string().optional(),
        site: z.string().trim().max(100).nullable().optional(),
        inboundAllowedIp: Ipv4OrCidrSchema.nullable().optional(),
        outboundTargetAddress: TargetAddressSchema.optional(),
    })
    .refine(
        (body) =>
            body.displayName !== undefined ||
            body.site !== undefined ||
            body.inboundAllowedIp !== undefined ||
            body.outboundTargetAddress !== undefined,
        { message: "Nothing to update" },
    );

/**
 * A count, a number of days or an interval. YAML reads `30` without quotes as a number, and
 * the settings page sends back what it read, so both spellings are accepted and stored as
 * the string the rest of the backend expects.
 */
const WholeNumberSettingSchema = z
    .union([
        z.string().regex(/^\d+$/, "Must be a whole number"),
        z.number().int().nonnegative(),
    ])
    .transform(String);

/**
 * `PUT /api/v1/settings/cleanup`.
 *
 * Loose on purpose: the settings page reads the whole block and sends it back, so a key an
 * operator added to config.yaml by hand travels through here on every save. A strict schema
 * would strip it and the save would delete it from the file.
 *
 * `security` is refused. It decides which networks may connect as an agent and whether
 * HSTS is sent, the page never edits it, and it belongs to config.yaml alone -- a stolen
 * session must not be able to lock every agent out.
 */
export const CleanupSettingsSchema = z.looseObject({
    token_retention_days: WholeNumberSettingSchema.optional(),
    token_cleanup_interval_hours: WholeNumberSettingSchema.optional(),
    notification_retention_days: WholeNumberSettingSchema.optional(),
    notification_retention_count: WholeNumberSettingSchema.optional(),
    notification_cleanup_interval_hours: WholeNumberSettingSchema.optional(),
    security: z
        .undefined({
            error: "Configured in config.yaml only, not through this endpoint",
        })
        .optional(),
});

// Agent web UI

/**
 * `POST /api/register` on the agent's own web server. The values decide which server the
 * agent obeys from then on, so the URL has to be http(s) and nothing else.
 */
export const AgentWebRegisterSchema = z.object({
    url: z.url({ protocol: /^https?$/, error: "Must be an http:// or https:// URL" }),
    token: z.string().trim().min(1),
    pin: z.string().trim().min(1),
});

// Server configuration (config.yaml)

/**
 * The `settings` block, with every default the server falls back to. Loose for the same
 * reason CleanupSettingsSchema is: the settings page writes the block back whole, so a key
 * added by hand has to survive. Values are stored as strings, whatever spelling YAML used.
 */
export const AppSettingsSchema = z
    .looseObject({
        token_retention_days: WholeNumberSettingSchema.default("30"),
        token_cleanup_interval_hours: WholeNumberSettingSchema.default("24"),
        notification_retention_days: WholeNumberSettingSchema.default("90"),
        notification_retention_count: WholeNumberSettingSchema.default("500"),
        notification_cleanup_interval_hours: WholeNumberSettingSchema.default("24"),
    })
    .prefault({});

/**
 * OIDC. The example config ships the block with empty fields and `enabled: false`, so the
 * fields are only required -- and checked -- once the block is switched on.
 */
export const OidcConfigSchema = z
    .looseObject({
        enabled: z.boolean().default(false),
        issuer: z.string().nullish(),
        client_id: z.string().nullish(),
        client_secret: z.string().nullish(),
        redirect_uri: z.string().nullish(),
    })
    .superRefine((oidc, ctx) => {
        if (!oidc.enabled) return;
        for (const key of ["issuer", "redirect_uri"] as const) {
            if (!z.url().safeParse(oidc[key]).success) {
                ctx.addIssue({
                    code: "custom",
                    path: [key],
                    message: "Required as a URL while oidc.enabled is true",
                });
            }
        }
        for (const key of ["client_id", "client_secret"] as const) {
            if (!oidc[key]) {
                ctx.addIssue({
                    code: "custom",
                    path: [key],
                    message: "Required while oidc.enabled is true",
                });
            }
        }
    });

export const SecurityConfigSchema = z
    .object({
        /** Networks an agent may connect from at all. Empty means no restriction. */
        allowed_networks: z.array(Ipv4OrCidrSchema).default([]),
        /** Send Strict-Transport-Security. Off unless set -- see config.example.yaml. */
        hsts: z.boolean().default(false),
        /**
         * Whether an outbound agent dialled over `wss://` may present a certificate this
         * server cannot verify. Off by default, so a wrong or expired certificate is a
         * failed connection rather than a silent one.
         *
         * It exists because an agent on a home network usually carries a self-signed
         * certificate, and the alternative -- running a CA for a handful of hosts -- is
         * more than that situation warrants. Mirrors `allowSelfSignedCertificates` on the
         * agent, which is the same decision for the other direction of the same link.
         */
        allow_self_signed_agent_certificates: z.boolean().default(false),
    })
    .prefault({});

/**
 * The whole of config.yaml.
 *
 * Loose at the top level: saveConfig() writes the parsed object back into the YAML
 * document, so a strict schema would not only ignore a key an operator added -- the next
 * save would delete it from the file.
 *
 * `jwtSecret` is required although a fresh installation has none: the server generates and
 * saves one before this schema is applied, so a missing value at that point is an error,
 * not a server that signs tokens with `undefined`.
 */
export const AppConfigSchema = z.looseObject({
    jwtSecret: z.string().min(1),
    /** Any span @fastify/jwt accepts. There is no way to switch expiry off. */
    jwtExpiresIn: z.string().min(1).default("12h"),
    logLevel: LogLevelSchema.optional(),
    /**
     * Optional like `logLevel`, and for the same reason: left out it stays DEFAULT_SERVER_PORT,
     * and nothing writes the number into a file the operator never put it in.
     */
    port: z.number().int().min(1).max(65535).optional(),
    oidc: blockOrMissing(OidcConfigSchema.optional()),
    settings: blockOrMissing(AppSettingsSchema),
    security: blockOrMissing(SecurityConfigSchema),
});

export type AppConfigParsed = z.output<typeof AppConfigSchema>;

// WebSocket messages from the server to the agent

/** `REGISTRATION_REQUEST` on the agent's /ws/register (server dials the agent). */
export const RegistrationRequestSchema = z.object({
    /** The agent's setup PIN or its `KASM_REGISTRATION_SECRET`. */
    secret: z.string(),
    authToken: z.string().min(1),
    /**
     * The id the server files this agent under. Required: the agent presents it together
     * with the token on every later connection, and one half without the other is an
     * identity that cannot connect.
     */
    clientId: z.string().min(1),
});

// WebSocket messages from the agent to the server

/**
 * One VRRP instance as the agent read it out of keepalived. Loose, like every agent payload:
 * a newer agent that reports more must not be dropped, only one the server would trip over.
 */
export const VrrpInstanceSchema = z.looseObject({
    name: z.string().min(1),
    /** An unknown word becomes UNKNOWN rather than refusing the whole snapshot. */
    state: z.enum(VRRP_STATES).catch("UNKNOWN"),
    /** The state the configuration asks for (`state MASTER|BACKUP`), if the dump names it. */
    wantedState: z.enum(VRRP_STATES).catch("UNKNOWN").nullish(),
    interface: z.string().nullish(),
    vrid: z.number().int().nullish(),
    /** Configured priority. */
    priority: z.number().int().nullish(),
    /** Priority after track scripts and interfaces have adjusted it. */
    effectivePriority: z.number().int().nullish(),
    /** Seconds; keepalived may report fractions. */
    advertInterval: z.number().nullish(),
    /** Virtual addresses, with prefix length where the dump gives one. */
    vips: z.array(z.string()).default([]),
    syncGroup: z.string().nullish(),
    /** When the instance last changed state, as the agent saw it. */
    lastTransition: z.string().nullish(),
    /** Counters from the stats dump, keyed by keepalived's own names in snake case. */
    stats: z.record(z.string(), z.number()).nullish(),
});

export const VrrpSyncGroupSchema = z.looseObject({
    name: z.string().min(1),
    state: z.enum(VRRP_STATES).catch("UNKNOWN"),
    instances: z.array(z.string()).default([]),
});

/**
 * `KEEPALIVED_UPDATE`: everything the agent read in one pass. `running: false` is a valid
 * reading of its own -- keepalived is not running -- and carries no instances; `error` says
 * why a running keepalived could not be read.
 */
export const KeepalivedStatusSchema = z.looseObject({
    running: z.boolean(),
    pid: z.number().int().nullish(),
    version: z.string().nullish(),
    /** Which dump the instances come from. */
    source: z.enum(["json", "data"]).nullish(),
    collectedAt: z.string().min(1),
    error: z.string().nullish(),
    instances: z.array(VrrpInstanceSchema).default([]),
    syncGroups: z.array(VrrpSyncGroupSchema).default([]),
});

/**
 * `KEEPALIVED_STATE_UPDATE`: a client's last reading together with when the server received
 * it.
 */
export const KeepalivedStateSchema = KeepalivedStatusSchema.extend({
    clientId: z.string().min(1),
    receivedAt: z.string().min(1),
});

// ── Activity ─────────────────────────────────────────────────────────────────

/**
 * What an event is about. Loose on purpose: an agent that knows more about its subject than
 * this build asks for should not have that trimmed off on the way in.
 */
export const ActivitySubjectSchema = z.looseObject({
    instanceName: z.string().optional(),
    vrid: z.number().optional(),
    interface: z.string().optional(),
});

/**
 * One thing that happened, as its originator saw it. The originator gives it an id, so
 * delivery may repeat without the event doing so: the server stores it under that id and a
 * second copy changes nothing.
 *
 * None of the three vocabulary fields -- `kind`, `level`, `source` -- may refuse a word it
 * does not know. An agent of another version may report one, and refusing it would throw
 * away an observation nobody can make again. `kind` is therefore a plain string rather than
 * an enum over `ACTIVITY_KINDS`; the dashboard phrases what it recognises and falls back to
 * a generic line for the rest. `level` and `source` stay enums but normalise an unknown
 * value instead of rejecting it -- the readers of those two compare against the known set
 * (`ACTIVITY_LEVELS.indexOf` in the frontend), so a foreign word passed through would read
 * as "below everything" rather than as itself.
 */
export const ActivityEventSchema = z.object({
    id: z.string().min(1),
    /** The originator's clock. The server records its own arrival time separately. */
    occurredAt: z.string().min(1),
    // `ingest` overwrites this with what the connection says anyway, so it must never be
    // the reason an event is refused.
    source: z.enum(ACTIVITY_SOURCES).catch("agent"),
    clientId: z.string().nullish(),
    kind: z.string().min(1),
    // A level this build does not know becomes `info`: visible, and comparable against the
    // levels that do exist. The table has no CHECK constraint, so this enum is the only
    // guard there is.
    level: z.enum(ACTIVITY_LEVELS).catch("info"),
    /** Groups events that belong together, entered by whoever caused them. */
    correlationId: z.string().nullish(),
    subject: ActivitySubjectSchema.nullish(),
    data: z.record(z.string(), z.unknown()).nullish(),
});

/**
 * `ACTIVITY`. A batch, because an agent that was offline has a queue to hand over and one
 * message per event would be a burst of them on every reconnect. `clientId` is not read off
 * the payload: the connection the batch arrives on says whose events these are.
 */
export const ActivityBatchSchema = z.object({
    events: z.array(ActivityEventSchema).min(1),
});

/**
 * The envelope of an `ACTIVITY` batch, without its contents. The server parses the events
 * one by one against `ActivityEventSchema` instead of the whole array at once: an event it
 * cannot read must not take the rest of the batch with it, because an unacknowledged batch
 * is offered again on every connection and the same queue head would block for as long as
 * the agent keeps it.
 */
export const ActivityBatchEnvelopeSchema = z.object({
    events: z.array(z.unknown()).min(1),
});

/** `POST /api/v1/activity/seen`. The events the calling user has seen. */
export const MarkActivitySeenSchema = z.object({
    ids: z.array(z.string().min(1)).min(1),
});

/** `ACTIVITY_ACK`. The ids the server has stored; the agent drops them from its queue. */
export const ActivityAckSchema = z.object({
    ids: z.array(z.string().min(1)),
});

/**
 * An event as the server holds it.
 *
 * The two timestamps are the point. After an offline stretch an event from 03:00 arrives at
 * 08:00: the list is ordered by `occurredAt`, because that is when it happened, while "new
 * to me" rests on `seenBy`, so a late arrival cannot slip in below the entries a user has
 * already worked through. Their difference also exposes an agent whose clock is wrong.
 */
export const ActivityRecordSchema = ActivityEventSchema.extend({
    receivedAt: z.string().min(1),
    /**
     * Ids of the users who have seen the event. Numbers: they come from the JWT, which
     * carries `users.id` as the INTEGER it is.
     */
    seenBy: z.array(z.number().int()),
});

// ── Schedulers ───────────────────────────────────────────────────────────────

/**
 * `SCHEDULER_STATUS_UPDATE` as the dashboard parses it. The types in types.ts are written
 * by hand, generic over the scheduler; this schema is checked against them there. Every
 * scheduler reports `{ removed }` as its result, so one shape covers all of them.
 */
export const SchedulerStatusUpdateSchema = z.object({
    scheduler: z.enum(SCHEDULER_IDS),
    status: z.object({
        isRunning: z.boolean(),
        nextRun: z.string().nullable(),
        lastRun: z
            .object({
                trigger: z.enum(SCHEDULER_TRIGGERS),
                status: z.enum(SCHEDULER_RUN_STATUSES),
                startedAt: z.string(),
                finishedAt: z.string().nullable(),
                result: z.object({ removed: z.number() }).nullable(),
                error: z.string().nullable(),
            })
            .nullable(),
    }),
});

// ── Dashboard ────────────────────────────────────────────────────────────────

/**
 * What the server pushes to a dashboard session. The agent side of the protocol is parsed
 * on arrival; this is the same guarantee for the browser side, so a payload that does not
 * match is dropped instead of reaching a store.
 *
 * A union over `type` rather than three separate parses: the dashboard sees one stream, and
 * a message of an unknown type has to fail here, not somewhere downstream. The server is
 * trusted, so this is a guard against version drift between the two halves, not against an
 * attacker.
 */
export const DashboardMessageSchema = z.discriminatedUnion("type", [
    z.object({
        type: z.literal(WS_EVENTS.CLIENTS_UPDATE),
        payload: z.array(ClientSchema),
    }),
    z.object({
        type: z.literal(WS_EVENTS.KEEPALIVED_STATE_UPDATE),
        payload: KeepalivedStateSchema,
    }),
    z.object({
        type: z.literal(WS_EVENTS.ACTIVITY_UPDATE),
        payload: z.array(ActivityRecordSchema),
    }),
    z.object({
        type: z.literal(WS_EVENTS.SCHEDULER_STATUS_UPDATE),
        payload: SchedulerStatusUpdateSchema,
    }),
]);
