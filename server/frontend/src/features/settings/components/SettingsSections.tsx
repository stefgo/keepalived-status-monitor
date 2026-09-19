import { apiFetch } from "../../../lib/apiFetch";
import { formatDate } from "../../../utils";
import type { SectionProps } from "../sections";
import { FieldCaption, ManualRunBox, NumberField, SectionHeader } from "./SettingsParts";

/** Starts a maintenance job and returns its answer; throws when the server refuses. */
async function runJob<T>(url: string): Promise<T> {
    const response = await apiFetch(url, { method: "POST" });
    if (!response.ok) throw new Error("The server refused to start the job");
    return (await response.json()) as T;
}

export const TokenRetentionSection = ({ values, onChange }: SectionProps) => (
    <section>
        <SectionHeader title="Retention of invalid client tokens">
            Define how long registration tokens are kept after they become invalid.
        </SectionHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <NumberField
                label="Retention Time (Days)"
                value={values.retention_invalid_tokens_days}
                onChange={(v) => onChange("retention_invalid_tokens_days", v)}
                placeholder="30"
                hint="Number of days an invalid token remains in the database."
            />
            <NumberField
                label="Minimum Keep Count"
                value={values.retention_invalid_tokens_count}
                onChange={(v) => onChange("retention_invalid_tokens_count", v)}
                placeholder="10"
                hint="Ensure at least this many invalid tokens are always kept."
            />
        </div>

        <ManualRunBox
            description="Trigger the maintenance process immediately using the saved retention settings."
            failureTitle="Could not remove the invalid tokens"
            onRun={async () => {
                const data = await runJob<{ removed?: number }>("/api/v1/settings/cleanup/invalid-tokens");
                return typeof data.removed === "number" ? `Removed ${data.removed}` : "Done";
            }}
        />
    </section>
);

interface NotificationSectionProps extends SectionProps {
    lastRun: string | null;
    /** A manual run moves the last-run time on the spot, without asking the server again. */
    onRan: (at: string) => void;
}

export const NotificationSection = ({ values, onChange, lastRun, onRan }: NotificationSectionProps) => (
    <section>
        <SectionHeader title="Notification History">
            Controls how long notifications are kept in the database. Old entries are removed
            automatically while always preserving a minimum number of the most recent notifications.
        </SectionHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <NumberField
                label="Retention Time (Days)"
                value={values.notification_retention_days}
                onChange={(v) => onChange("notification_retention_days", v)}
                min={1}
                placeholder="90"
                hint="Notifications older than this are eligible for removal."
            />
            <NumberField
                label="Minimum Keep Count"
                value={values.notification_retention_count}
                onChange={(v) => onChange("notification_retention_count", v)}
                placeholder="500"
                hint="Always keep at least this many of the most recent notifications, regardless of age."
            />
            <NumberField
                label="Cleanup Interval (Hours)"
                value={values.notification_cleanup_interval_hours}
                onChange={(v) => onChange("notification_cleanup_interval_hours", v)}
                placeholder="24"
                hint="How often the automatic cleanup runs. Set to 0 to disable the scheduler (manual runs still work)."
            />
            <div className="md:col-span-2">
                <FieldCaption>Last Run</FieldCaption>
                <p className="text-sm text-text-primary font-mono">{formatDate(lastRun)}</p>
            </div>
        </div>

        <ManualRunBox
            description="Immediately remove notifications that exceed the saved retention settings."
            failureTitle="Could not clean up the notifications"
            onRun={async () => {
                const data = await runJob<{ removed?: number }>("/api/v1/settings/cleanup/notifications");
                onRan(new Date().toISOString());
                return typeof data.removed === "number" ? `Removed ${data.removed}` : "Done";
            }}
        />
    </section>
);
