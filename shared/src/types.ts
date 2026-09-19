import { z } from "zod";
import {
    ACTIVITY_KINDS,
    ACTIVITY_LEVELS,
    ACTIVITY_SOURCES,
    CLIENT_STATUS,
    CONNECTION_MODE,
    VRRP_STATES,
} from "./constants.js";
import {
    AgentKeepalivedConfigSchema,
    ClientSchema,
    RegistrationPayloadSchema,
    RegistrationResponseSchema,
    TokenSchema,
    AuthPayloadSchema,
    LoginPayloadSchema,
    CreateUserSchema,
    UpdateUserSchema,
    CreateOutboundClientSchema,
    UpdateClientSchema,
    CleanupSettingsSchema,
    KeepalivedStatusSchema,
    VrrpInstanceSchema,
    VrrpSyncGroupSchema,
    ActivityEventSchema,
    ActivitySubjectSchema,
} from "./schemas.js";

export type RegistrationPayload = z.infer<typeof RegistrationPayloadSchema>;
export type RegistrationResponse = z.infer<typeof RegistrationResponseSchema>;

/**
 * Derived from the constants, so the value is written down in exactly one place and the
 * Zod enums in schemas.ts are built from the same objects.
 */
export type ClientStatus = (typeof CLIENT_STATUS)[keyof typeof CLIENT_STATUS];
export type ConnectionMode = (typeof CONNECTION_MODE)[keyof typeof CONNECTION_MODE];

export type Client = z.infer<typeof ClientSchema>;
export type AgentKeepalivedConfig = z.output<typeof AgentKeepalivedConfigSchema>;
export type Token = z.infer<typeof TokenSchema>;

// REST request bodies
export type LoginPayload = z.infer<typeof LoginPayloadSchema>;
export type CreateUser = z.infer<typeof CreateUserSchema>;
export type UpdateUser = z.infer<typeof UpdateUserSchema>;
export type CreateOutboundClient = z.infer<typeof CreateOutboundClientSchema>;
export type UpdateClient = z.infer<typeof UpdateClientSchema>;
export type CleanupSettings = z.infer<typeof CleanupSettingsSchema>;

// WS Payloads
export type AuthPayload = z.infer<typeof AuthPayloadSchema>;

export interface WsMessage<T = any> {
    type: string;
    payload: T;
}

/**
 * Payload types per event. `req` is what the sending side puts on the wire for that event;
 * for the agent's own messages that is the agent, which sends them through the typed
 * helpers in Connection instead of stringifying objects by hand.
 */
export interface ProtocolMap {
    AUTH: {
        req: AuthPayload;
        res: void;
    };
    KEEPALIVED_UPDATE: {
        req: KeepalivedStatus;
        res: void;
    };
    AUTH_SUCCESS: {
        req: void;
        res: { lastSyncTime?: string | null };
    };
    AUTH_FAILURE: {
        req: { error?: string };
        res: void;
    };
    ACTIVITY: {
        req: { events: ActivityEvent[] };
        res: void;
    };
}

// ── keepalived ───────────────────────────────────────────────────────────────

export type VrrpState = (typeof VRRP_STATES)[number];
export type VrrpInstance = z.infer<typeof VrrpInstanceSchema>;
export type VrrpSyncGroup = z.infer<typeof VrrpSyncGroupSchema>;
export type KeepalivedStatus = z.infer<typeof KeepalivedStatusSchema>;

/** A client's last reading together with when the server received it. */
export interface KeepalivedState extends KeepalivedStatus {
    clientId: string;
    receivedAt: string;
}

/** One host's part in a VRRP cluster. */
export interface VrrpClusterMember {
    clientId: string;
    /**
     * Whether the host's agent is connected. An offline member's instance is its last
     * report, not its present state, and the health below does not count it.
     */
    online: boolean;
    instance: VrrpInstance;
}

export type VrrpClusterHealth = "ok" | "split-brain" | "no-master" | "vip-mismatch" | "degraded" | "unknown";

/**
 * The instances of all hosts that answer for the same virtual router. The server groups them
 * by the site of their client, the VRID, and the network their virtual addresses sit on: a
 * VRID is unique per broadcast domain only, and two unrelated clusters on different segments
 * may well share one -- private networks included, which is what the site is for.
 *
 * The addresses are not part of that identity. They are what this tool watches, so a cluster
 * that changed identity whenever they did could never report that its hosts disagree about
 * them.
 */
export interface VrrpCluster {
    key: string;
    /** The site all members' clients share; null for clients without one. */
    site: string | null;
    vrid: number | null;
    /**
     * The networks the cluster's addresses sit on, canonically written (`172.28.0.0/24`).
     * What tells two clusters of one site and VRID apart. Empty for instances that report no
     * address at all, which are grouped by their instance name instead.
     */
    networks: string[];
    /** Every address the members carry between them; where they differ, see `health`. */
    vips: string[];
    members: VrrpClusterMember[];
    /**
     * Counted over online members only. `split-brain`: more than one MASTER. `no-master`:
     * online members exist, none is MASTER. `vip-mismatch`: the members do not all carry the
     * same addresses, so a failover would change which of them are up. `degraded`: one
     * MASTER holds, but a member is in FAULT, offline, or the only one left. `unknown`: no
     * member is online.
     *
     * `vip-mismatch` is the one case counted over **every** member, online or not: it is a
     * statement about the configuration rather than the present state. A running outage is
     * more urgent than a misconfiguration, so `split-brain` and `no-master` keep their place
     * where the addresses disagree as well.
     */
    health: VrrpClusterHealth;
}

// ── Activity ─────────────────────────────────────────────────────────────────

export type ActivitySource = (typeof ACTIVITY_SOURCES)[number];
export type ActivityLevel = (typeof ACTIVITY_LEVELS)[number];

/**
 * The kinds this build can phrase. The wire accepts any string -- see `ActivityEventSchema`
 * -- so this is the authoring type, not the parsing one: it is what a `kind` literal in our
 * own code is checked against, while an incoming event may carry one nobody here knows yet.
 */
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export type ActivitySubject = z.infer<typeof ActivitySubjectSchema>;

/**
 * One event as its originator sent it. There is no message in here: the text is written in
 * the frontend out of `kind` and `data`. That is what lets an agent of an older version
 * stay useful -- it reports the same facts, and how they are worded is not its business --
 * and what makes filtering by kind and level exact instead of a search over sentences.
 */
export type ActivityEvent = z.infer<typeof ActivityEventSchema>;

/**
 * An event as the server holds it.
 *
 * The two timestamps are the point. After an offline stretch an event from 03:00 arrives at
 * 08:00: the list is ordered by `occurredAt`, because that is when it happened, while "new
 * to me" rests on `seenBy`, so a late arrival cannot slip in below the entries a user has
 * already worked through. Their difference also exposes an agent whose clock is wrong.
 */
export interface ActivityRecord extends ActivityEvent {
    receivedAt: string;
    /**
     * Ids of the users who have seen the event. Numbers: they come from the JWT, which
     * carries `users.id` as the INTEGER it is.
     */
    seenBy: number[];
}
