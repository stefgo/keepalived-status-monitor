import { Bell, Sliders, type LucideIcon } from "lucide-react";

/** The settings block as the API sends it: every value a string, whatever it means. */
export type SettingsValues = Record<string, string>;

export type SectionId = "tokens" | "notifications";

export interface SectionDef {
    id: SectionId;
    label: string;
    icon: LucideIcon;
    /**
     * The keys this section edits, and so the keys its Save sends. The server merges what
     * arrives into the stored block, so a section never writes over another section's edits.
     */
    keys: readonly string[];
}

export const SECTIONS: readonly SectionDef[] = [
    {
        id: "tokens",
        label: "Client Tokens",
        icon: Sliders,
        keys: ["retention_invalid_tokens_days", "retention_invalid_tokens_count"],
    },
    {
        id: "notifications",
        label: "Notification History",
        icon: Bell,
        keys: [
            "notification_retention_days",
            "notification_retention_count",
            "notification_cleanup_interval_hours",
        ],
    },
];

export const SECTION_IDS: readonly SectionId[] = SECTIONS.map((s) => s.id);

/** What a section shows until the server has answered -- the server's own defaults. */
export const DEFAULT_SETTINGS: SettingsValues = {
    retention_invalid_tokens_days: "30",
    retention_invalid_tokens_count: "10",
    notification_retention_days: "90",
    notification_retention_count: "500",
    notification_cleanup_interval_hours: "24",
};

/** Whether the draft differs from what the server holds in any of the section's keys. */
export const isDirty = (section: SectionDef, draft: SettingsValues, saved: SettingsValues): boolean =>
    section.keys.some((key) => (draft[key] ?? "") !== (saved[key] ?? ""));

/** Props every section component takes: its values, and a way to change one of them. */
export interface SectionProps {
    values: SettingsValues;
    onChange: (key: string, value: string) => void;
}
