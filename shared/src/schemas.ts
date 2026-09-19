import { z } from "zod";
import {
    ACTIVITY_LEVELS,
    ACTIVITY_SOURCES,
    CLIENT_STATUS,
    CONNECTION_MODE,
    VRRP_STATES,
} from "./constants.js";
import { normaliseTargetAddress } from "./targetAddress.js";

/**
 * A single IPv4 address or an IPv4 network in CIDR notation. IPv4 only: addresses are
 * matched by the 32-bit comparison in network.ts, which cannot evaluate an IPv6 value.
 */
export const Ipv4OrCidrSchema = z.union([z.ipv4(), z.cidrv4()], {
    error: "Must be an IPv4 address or an IPv4 network in CIDR notation",
});

/**
 * The agent's `allowedNetworks` in its config.yaml. An object rather than the bare list so a
 * failure names the key and the entry (`allowedNetworks.1: ...`).
 */
export const AgentNetworkConfigSchema = z.object({
    allowedNetworks: z.array(Ipv4OrCidrSchema).default([]),
});

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

export const ClientSchema = z.object({
    id: z.uuid(),
    hostname: z.string(),
    displayName: z.string().optional(),
    /**
     * The network segment or location the operator put this client in. Part of the VRRP
     * cluster key: a VRID is unique only per segment, so hosts at two sites may use the same
     * one. Null means no site, which every client without one shares.
     */
    site: z.string().nullish(),
    status: z.enum(CLIENT_STATUS),
    lastSeen: z.string(),
    version: z.string().optional(),
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
    outboundTargetAddress: z.string().optional(),
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

export const TokenSchema = z.object({
    token: z.string(),
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

const BooleanSettingSchema = z
    .union([z.enum(["true", "false"]), z.boolean()])
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
    retention_invalid_tokens_days: WholeNumberSettingSchema.optional(),
    retention_invalid_tokens_count: WholeNumberSettingSchema.optional(),
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

/** YAML turns an empty block (`settings:` with nothing below it) into null. */
const blockOrMissing = <T extends z.ZodType>(schema: T) =>
    z.preprocess((value) => value ?? undefined, schema);

/**
 * The `settings` block, with every default the server falls back to. Loose for the same
 * reason CleanupSettingsSchema is: the settings page writes the block back whole, so a key
 * added by hand has to survive. Values are stored as strings, whatever spelling YAML used.
 */
export const AppSettingsSchema = z
    .looseObject({
        retention_invalid_tokens_days: WholeNumberSettingSchema.default("30"),
        retention_invalid_tokens_count: WholeNumberSettingSchema.default("10"),
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
    logLevel: z
        .enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"])
        .optional(),
    oidc: blockOrMissing(OidcConfigSchema.optional()),
    settings: blockOrMissing(AppSettingsSchema),
    security: blockOrMissing(SecurityConfigSchema),
});

export type AppConfigParsed = z.output<typeof AppConfigSchema>;

// WebSocket messages from the server to the agent

/** `REGISTRATION_REQUEST` on the agent's /ws/register (server dials the agent). */
export const RegistrationRequestSchema = z.object({
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

/** `ACTIVITY_ACK`. The ids the server has stored; the agent drops them from its queue. */
export const ActivityAckSchema = z.object({
    ids: z.array(z.string().min(1)),
});
