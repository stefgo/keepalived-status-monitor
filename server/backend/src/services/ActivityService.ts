import { randomUUID } from "crypto";
import {
    ActivityBatchEnvelopeSchema,
    ActivityEvent,
    ActivityEventSchema,
    ActivityKind,
    ActivityLevel,
    ActivityRecord,
    ActivitySubject,
    WS_EVENTS,
    firstIssue,
} from "@kasm/shared";
import { logger } from "@kasm/shared/node";
import { ActivityRepository } from "../repositories/ActivityRepository.js";
import { ProxyService } from "./ProxyService.js";

function broadcast(): void {
    ProxyService.broadcastToDashboard({
        type: WS_EVENTS.ACTIVITY_UPDATE,
        payload: ActivityRepository.list(),
    });
}

/** What the server itself reports. Everything else is observed on a host, by its agent. */
interface ServerEventInput {
    kind: ActivityKind;
    level: ActivityLevel;
    clientId?: string | null;
    correlationId?: string | null;
    subject?: ActivitySubject | null;
    data?: Record<string, unknown> | null;
}

export class ActivityService {
    static list(): ActivityRecord[] {
        return ActivityRepository.list();
    }

    /**
     * Records an event the server is the originator of: the connection state of an agent,
     * a registration, an action a user asked for. Everything that happens *on* a host is
     * reported by that host -- the server does not infer it from what it sees.
     */
    static record(input: ServerEventInput): ActivityRecord {
        const event: ActivityEvent = {
            id: randomUUID(),
            occurredAt: new Date().toISOString(),
            source: "server",
            clientId: input.clientId ?? null,
            kind: input.kind,
            level: input.level,
            correlationId: input.correlationId ?? null,
            subject: input.subject ?? null,
            data: input.data ?? null,
        };
        const [stored] = ActivityRepository.insertMany([event], event.occurredAt);
        broadcast();
        return stored;
    }

    /**
     * Takes a batch from an agent and returns the ids it may drop from its queue.
     *
     * `clientId` and `source` are overwritten with what the connection says rather than
     * trusted from the payload: an agent may only ever speak about itself, and the ack has
     * to cover ids that were actually stored -- an id acknowledged but not written would be
     * dropped on the agent and lost for good.
     */
    static ingest(clientId: string, events: ActivityEvent[]): string[] {
        const receivedAt = new Date().toISOString();
        const owned = events.map((event) => ({
            ...event,
            source: "agent" as const,
            clientId,
        }));
        const stored = ActivityRepository.insertMany(owned, receivedAt);
        if (stored.length > 0) broadcast();
        return stored.map((e) => e.id);
    }

    /**
     * Handles one `ACTIVITY` batch from an agent and acknowledges what it may drop.
     *
     * Never acknowledge what was not stored -- unless it can never be stored. An ack the
     * agent acts on deletes the event on the one side that still had it, so anything the
     * server merely failed to write stays unacknowledged and arrives again; the ids it
     * carries make the second copy a no-op.
     *
     * An event this build cannot parse is the exception. Re-offering it changes nothing:
     * the next connection reads it with the same schema and fails again, and because the
     * agent hands its queue over in order, that one event would block everything behind it
     * until `MAX_QUEUE_AGE_MS` expires. So it is acknowledged and logged as long as its id
     * can still be read -- one lost observation instead of a queue that stops moving.
     *
     * The events are therefore parsed one by one; only the envelope has to be sound for
     * anything at all to be read from it.
     */
    static handleBatch(clientId: string, payload: unknown): void {
        const parsed = ActivityBatchEnvelopeSchema.safeParse(payload);
        if (!parsed.success) {
            logger.warn(
                { clientId, error: firstIssue(parsed.error) },
                "Discarding malformed ACTIVITY batch from agent",
            );
            return;
        }

        const events: ActivityEvent[] = [];
        // Ids of events that will never parse. Acknowledged without being stored, which is
        // what keeps the agent's queue moving.
        const unreadable: string[] = [];
        for (const candidate of parsed.data.events) {
            const event = ActivityEventSchema.safeParse(candidate);
            if (event.success) {
                events.push(event.data);
                continue;
            }
            const id = (candidate as { id?: unknown } | null)?.id;
            if (typeof id === "string" && id.length > 0) {
                unreadable.push(id);
                logger.warn(
                    { clientId, id, error: firstIssue(event.error) },
                    "Acknowledging an unreadable activity event without storing it",
                );
            } else {
                // Nothing to acknowledge it by, so it is simply dropped. It no longer holds
                // up the events around it.
                logger.warn(
                    { clientId, error: firstIssue(event.error) },
                    "Discarding an activity event without a usable id",
                );
            }
        }

        const ids = [...this.ingest(clientId, events), ...unreadable];
        // An ack over nothing tells the agent nothing; it keeps what it offered either way.
        if (ids.length === 0) return;
        try {
            ProxyService.sendFireAndForget(clientId, WS_EVENTS.ACTIVITY_ACK, { ids });
        } catch {
            // The agent went away between its batch and this ack. It will offer the same
            // events again on its next connection.
        }
    }

    static markManySeen(ids: string[], userId: number): void {
        ActivityRepository.markManySeen(ids, userId);
        broadcast();
    }

    static deleteAll(): void {
        ActivityRepository.deleteAll();
        broadcast();
    }
}
