import { z } from "zod";
import {
    ACTIVITY_KINDS,
    ACTIVITY_LEVELS,
    ACTIVITY_SOURCES,
    CLIENT_STATUS,
    CONNECTION_MODE,
    SCHEDULER_IDS,
    SCHEDULER_RUN_STATUSES,
    SCHEDULER_TRIGGERS,
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
    KeepalivedStateSchema,
    VrrpInstanceSchema,
    VrrpSyncGroupSchema,
    ActivityEventSchema,
    ActivityRecordSchema,
    ActivitySubjectSchema,
    DashboardMessageSchema,
    SchedulerStatusUpdateSchema,
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

export interface WsMessage<T = unknown> {
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
export type KeepalivedState = z.infer<typeof KeepalivedStateSchema>;

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

/** An event as the server holds it. See `ActivityRecordSchema` for what the two times mean. */
export type ActivityRecord = z.infer<typeof ActivityRecordSchema>;

// ── Schedulers ───────────────────────────────────────────────────────────────

export type SchedulerId = (typeof SCHEDULER_IDS)[number];
export type SchedulerTrigger = (typeof SCHEDULER_TRIGGERS)[number];
export type SchedulerRunStatus = (typeof SCHEDULER_RUN_STATUSES)[number];

/** What each scheduler reports as the result of a run. */
export interface SchedulerRunResults {
    "notification-cleanup": { removed: number };
    "token-cleanup": { removed: number };
}

/** The last run a scheduler finished, as `scheduler_state` holds it. */
export interface SchedulerRunSummary<Id extends SchedulerId = SchedulerId> {
    trigger: SchedulerTrigger;
    status: SchedulerRunStatus;
    startedAt: string;
    /** Null for a run the server did not live to finish (`interrupted`). */
    finishedAt: string | null;
    /** Null unless the run succeeded, fully or in part. */
    result: SchedulerRunResults[Id] | null;
    error: string | null;
}

export interface SchedulerStatus<Id extends SchedulerId = SchedulerId> {
    isRunning: boolean;
    /** Null when the scheduler is switched off. */
    nextRun: string | null;
    lastRun: SchedulerRunSummary<Id> | null;
}

/** `GET /api/v1/settings/scheduler-status`: every scheduler the server runs. */
export type SchedulerStatuses = {
    [Id in SchedulerId]: SchedulerStatus<Id>;
};

/** The payload of `SCHEDULER_STATUS_UPDATE`: one scheduler, whenever a run starts or ends. */
export type SchedulerStatusUpdate = {
    [Id in SchedulerId]: { scheduler: Id; status: SchedulerStatuses[Id] };
}[SchedulerId];

/**
 * The dashboard parses `SCHEDULER_STATUS_UPDATE` with `SchedulerStatusUpdateSchema`, which
 * is written separately from the types above. This fails to compile as soon as the two
 * drift apart, in either direction.
 */
const schedulerStatusUpdateMatchesSchema: [
    (update: SchedulerStatusUpdate) => z.infer<typeof SchedulerStatusUpdateSchema>,
    (parsed: z.infer<typeof SchedulerStatusUpdateSchema>) => SchedulerStatusUpdate,
] = [(update) => update, (parsed) => parsed];
void schedulerStatusUpdateMatchesSchema;

// ── Dashboard ────────────────────────────────────────────────────────────────

/** One message of the server-to-dashboard stream, as `DashboardMessageSchema` parses it. */
export type DashboardMessage = z.infer<typeof DashboardMessageSchema>;
