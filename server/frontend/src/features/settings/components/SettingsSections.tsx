import { apiFetch } from "../../../lib/apiFetch";
import type { SectionProps } from "../sections";
import { SchedulerBox } from "./SchedulerBox";
import { ManualRun, NumberField, SectionHeader } from "./SettingsParts";

/** Starts a maintenance job and returns its answer; throws when the server refuses. */
async function runJob<T>(url: string): Promise<T> {
    const response = await apiFetch(url, { method: "POST" });
    if (!response.ok) throw new Error("The server refused to start the job");
    return (await response.json()) as T;
}

export const TokenRetentionSection = ({ values, onChange }: SectionProps) => (
    <section>
        <SectionHeader title="Retention of invalid client tokens">
            Define how long registration tokens are kept after they become invalid. A scheduled
            cleanup removes the ones older than that.
        </SectionHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <NumberField
                label="Retention Time (Days)"
                value={values.token_retention_days}
                onChange={(v) => onChange("token_retention_days", v)}
                placeholder="30"
                hint="Number of days an invalid token remains in the database."
            />
            <NumberField
                label="Cleanup Interval (Hours)"
                value={values.token_cleanup_interval_hours}
                onChange={(v) => onChange("token_cleanup_interval_hours", v)}
                placeholder="24"
                hint="How often the automatic cleanup runs. Set to 0 to disable the scheduler (manual runs still work)."
            />
        </div>

        <SchedulerBox scheduler="token-cleanup">
            <ManualRun
                description="Trigger the maintenance process immediately using the saved retention settings."
                failureTitle="Could not remove the invalid tokens"
                onRun={async () => {
                    const data = await runJob<{ removed?: number }>("/api/v1/settings/cleanup/invalid-tokens");
                    return typeof data.removed === "number" ? `Removed ${data.removed}` : "Done";
                }}
            />
        </SchedulerBox>
    </section>
);

export const ActivitySection = ({ values, onChange }: SectionProps) => (
    <section>
        <SectionHeader title="Activity History">
            Controls how long activity events are kept in the database. Old entries are removed
            automatically while always preserving a minimum number of the most recent events.
        </SectionHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <NumberField
                label="Retention Time (Days)"
                value={values.notification_retention_days}
                onChange={(v) => onChange("notification_retention_days", v)}
                min={1}
                placeholder="90"
                hint="Events older than this are eligible for removal."
            />
            <NumberField
                label="Minimum Keep Count"
                value={values.notification_retention_count}
                onChange={(v) => onChange("notification_retention_count", v)}
                placeholder="500"
                hint="Always keep at least this many of the most recent events, regardless of age."
            />
            <NumberField
                label="Cleanup Interval (Hours)"
                value={values.notification_cleanup_interval_hours}
                onChange={(v) => onChange("notification_cleanup_interval_hours", v)}
                placeholder="24"
                hint="How often the automatic cleanup runs. Set to 0 to disable the scheduler (manual runs still work)."
            />
        </div>

        <SchedulerBox scheduler="notification-cleanup">
            <ManualRun
                description="Immediately remove activity events that exceed the saved retention settings."
                failureTitle="Could not clean up the activity history"
                onRun={async () => {
                    const data = await runJob<{ removed?: number }>("/api/v1/settings/cleanup/notifications");
                    return typeof data.removed === "number" ? `Removed ${data.removed}` : "Done";
                }}
            />
        </SchedulerBox>
    </section>
);
