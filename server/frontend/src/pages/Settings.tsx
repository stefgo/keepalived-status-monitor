import { useState, useEffect, useCallback } from "react";
import { Save, Settings as SettingsIcon } from "lucide-react";
import {
    Button,
    Card,
    cn,
    FOCUS_RING_INSET,
    TabList,
    TabPanel,
    useConfirm,
    useTabs,
    useToast,
} from "@stefgo/react-ui-components";
import { useSearchQueryParam } from "../hooks/useSearchQueryParam";
import { LoadingIndicator } from "../components/LoadingIndicator";
import { describeFailure } from "../utils";
import { apiFetch } from "../lib/apiFetch";
import {
    DEFAULT_SETTINGS,
    SECTIONS,
    SECTION_IDS,
    isDirty,
    type SectionDef,
    type SectionId,
    type SettingsValues,
} from "../features/settings/sections";
import {
    NotificationSection,
    TokenRetentionSection,
} from "../features/settings/components/SettingsSections";

interface SchedulerStatusResponse {
    notificationCleanupLastRun?: string | null;
}

/** Loads the scheduler status without touching state; null when it cannot be read. */
async function requestSchedulerStatus(): Promise<SchedulerStatusResponse | null> {
    try {
        const response = await apiFetch("/api/v1/settings/scheduler-status");
        return response.ok ? await response.json() : null;
    } catch (e) {
        console.error("Failed to fetch scheduler status:", e);
        return null;
    }
}

// The tab fills the sidebar's width, so the ring is drawn inside it -- an outward one would
// be clipped by the panel border next to it.
const TAB_CLASS = cn(
    "w-full flex items-center gap-3 px-4 py-3 text-sm font-medium text-left transition duration-200 cursor-pointer border-l-4 border-transparent hover:bg-hover",
    FOCUS_RING_INSET,
);
const TAB_SELECTED_CLASS =
    "bg-primary/10 text-primary border-l-primary shadow-[inset_0_1px_1px_rgba(0,0,0,0.05)] hover:bg-primary/10";

/**
 * The server's own settings, one section per tab.
 *
 * Each section saves on its own and sends only its own keys; the server merges them into the
 * stored block. It used to be one Save under all tabs, which wrote whatever had been
 * touched anywhere -- including edits in a tab that was no longer on screen. A tab with
 * edits that are not saved yet carries a dot, so they are not forgotten either.
 *
 * The open tab is in the URL, so a reload lands on it.
 */
export default function Settings() {
    const { alert } = useConfirm();
    const { show } = useToast();

    /** What the server holds, as last loaded or saved. */
    const [saved, setSaved] = useState<SettingsValues>(DEFAULT_SETTINGS);
    /** What the fields show, saved or not. */
    const [draft, setDraft] = useState<SettingsValues>(DEFAULT_SETTINGS);
    const [savingSection, setSavingSection] = useState<SectionId | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [notificationCleanupLastRun, setNotificationCleanupLastRun] = useState<string | null>(null);

    const [tab, setTab] = useSearchQueryParam("tab");
    const tabs = useTabs({
        tabs: SECTION_IDS,
        value: (SECTION_IDS as readonly string[]).includes(tab) ? tab : SECTION_IDS[0],
        onChange: setTab,
        orientation: "vertical",
    });

    // Split into a request that touches no state and a function that applies its answer:
    // the effect below may only set state once the response is there, and a save loads the
    // status again afterwards. The state setter is stable by definition.
    const applySchedulerStatus = useCallback((data: SchedulerStatusResponse) => {
        if (typeof data.notificationCleanupLastRun === "string" || data.notificationCleanupLastRun === null) {
            setNotificationCleanupLastRun(data.notificationCleanupLastRun);
        }
    }, []);

    // Settings and scheduler status are loaded once, inside the effect. isLoading starts
    // out true, so the load only ever has to lower it.
    useEffect(() => {
        let cancelled = false;
        const loadSettings = async () => {
            try {
                const response = await apiFetch("/api/v1/settings/cleanup");
                if (response.ok) {
                    const data = (await response.json()) as SettingsValues;
                    if (!cancelled) {
                        const loaded = { ...DEFAULT_SETTINGS, ...data };
                        setSaved(loaded);
                        setDraft(loaded);
                    }
                }
            } catch (e) {
                console.error("Failed to fetch settings:", e);
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        };
        loadSettings();
        requestSchedulerStatus().then((data) => {
            if (!cancelled && data) applySchedulerStatus(data);
        });
        return () => {
            cancelled = true;
        };
    }, [applySchedulerStatus]);

    const change = (key: string, value: string) => setDraft((prev) => ({ ...prev, [key]: value }));

    const save = async (section: SectionDef) => {
        const body = Object.fromEntries(section.keys.map((key) => [key, draft[key] ?? ""]));
        setSavingSection(section.id);
        try {
            const response = await apiFetch("/api/v1/settings/cleanup", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            if (!response.ok) {
                // The endpoint validates the body and names the offending field.
                const err = await response.json().catch(() => ({}));
                throw new Error(err.error || "Failed to save settings");
            }
            setSaved((prev) => ({ ...prev, ...body }));
            show({ variant: "success", title: `${section.label} saved` });
            // A changed interval moves the next scheduled run.
            const status = await requestSchedulerStatus();
            if (status) applySchedulerStatus(status);
        } catch (e: unknown) {
            alert(describeFailure("Could not save the settings", e));
        } finally {
            setSavingSection(null);
        }
    };

    if (isLoading) {
        return <LoadingIndicator label="Loading settings…" />;
    }

    const renderSection = (id: SectionId) => {
        switch (id) {
            case "tokens":
                return <TokenRetentionSection values={draft} onChange={change} />;
            case "notifications":
                return (
                    <NotificationSection
                        values={draft}
                        onChange={change}
                        lastRun={notificationCleanupLastRun}
                        onRan={setNotificationCleanupLastRun}
                    />
                );
        }
    };

    return (
        <Card
            title={
                <>
                    <SettingsIcon size={18} className="text-text-muted" /> System Settings
                </>
            }
            className="overflow-visible"
            padding="none"
        >
            <div className="flex flex-col md:flex-row min-h-[450px]">
                <TabList
                    tabs={tabs}
                    aria-label="Settings sections"
                    className="w-full md:w-64 shrink-0 bg-app-bg border-b md:border-b-0 md:border-r border-border py-4 flex flex-col gap-1"
                >
                    {SECTIONS.map((section) => {
                        const { selected, ...tabAttributes } = tabs.tabProps(section.id);
                        const dirty = isDirty(section, draft, saved);
                        return (
                            <button
                                key={section.id}
                                type="button"
                                {...tabAttributes}
                                className={cn(TAB_CLASS, selected && TAB_SELECTED_CLASS)}
                            >
                                <section.icon size={18} />
                                <span className="flex-1">{section.label}</span>
                                {dirty && (
                                    <>
                                        <span aria-hidden="true" className="w-2 h-2 rounded-full bg-warning" />
                                        <span className="sr-only">(unsaved changes)</span>
                                    </>
                                )}
                            </button>
                        );
                    })}
                </TabList>

                <div className="flex-1 min-w-0">
                    {SECTIONS.map((section) => (
                        <TabPanel
                            key={section.id}
                            tabs={tabs}
                            value={section.id}
                            className="p-8 animate-in fade-in slide-in-from-right-2 duration-300"
                        >
                            <div className="space-y-8">
                                {renderSection(section.id)}

                                <div className="flex justify-end border-t border-border pt-4">
                                    <Button
                                        variant="primary"
                                        icon={Save}
                                        onClick={() => save(section)}
                                        disabled={!isDirty(section, draft, saved) || savingSection !== null}
                                        isLoading={savingSection === section.id}
                                    >
                                        Save
                                    </Button>
                                </div>
                            </div>
                        </TabPanel>
                    ))}
                </div>
            </div>
        </Card>
    );
}
