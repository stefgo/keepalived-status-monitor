import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Save, Settings as SettingsIcon } from "lucide-react";
import {
    Button,
    Card,
    TabList,
    TabPanel,
    useConfirm,
    useTabs,
    useToast,
    LoadingIndicator,
    SideTab,
} from "@stefgo/react-ui-components";
import { useSearchQueryParam } from "../hooks/useSearchQueryParam";
import { describeFailure } from "../utils";
import { QueryError } from "../components/QueryError";
import { schedulerStatusOptions } from "../queries/scheduler";
import { loadSettings, saveSettings } from "../queries/settings";
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
    ActivitySection,
    TokenRetentionSection,
} from "../features/settings/components/SettingsSections";

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
    /** Why the settings could not be read. Set, the form is not shown at all. */
    const [loadError, setLoadError] = useState<unknown>(null);

    const [tab, setTab] = useSearchQueryParam("tab");
    const tabs = useTabs({
        tabs: SECTION_IDS,
        value: (SECTION_IDS as readonly string[]).includes(tab) ? tab : SECTION_IDS[0],
        onChange: setTab,
        orientation: "vertical",
    });

    const queryClient = useQueryClient();

    // Loaded once, into the draft. Deliberately not a cache entry: one that is read again
    // behind the form would overwrite what is typed and not yet saved. The scheduler status
    // below the fields is one, and follows the socket. isLoading starts out true, so the
    // load only ever has to lower it.
    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const data = await loadSettings();
                if (!cancelled) {
                    const loaded = { ...DEFAULT_SETTINGS, ...data };
                    setSaved(loaded);
                    setDraft(loaded);
                }
            } catch (e) {
                if (!cancelled) setLoadError(e);
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        };
        load();
        return () => {
            cancelled = true;
        };
    }, []);

    const change = (key: string, value: string) => setDraft((prev) => ({ ...prev, [key]: value }));

    const save = async (section: SectionDef) => {
        const body = Object.fromEntries(section.keys.map((key) => [key, draft[key] ?? ""]));
        setSavingSection(section.id);
        try {
            // The endpoint validates the body and names the offending field.
            await saveSettings(body);
            setSaved((prev) => ({ ...prev, ...body }));
            show({ variant: "success", title: `${section.label} saved` });
            // A changed interval moves the next scheduled run.
            void queryClient.invalidateQueries({ queryKey: schedulerStatusOptions.queryKey });
        } catch (e: unknown) {
            alert(describeFailure("Could not save the settings", e));
        } finally {
            setSavingSection(null);
        }
    };

    if (isLoading) {
        return <LoadingIndicator label="Loading settings…" />;
    }

    // Without what the server holds, the fields would show the defaults as if they were
    // saved -- and a save would write them over the real values.
    if (loadError) {
        return <QueryError title="Could not load the settings" error={loadError} />;
    }

    const renderSection = (id: SectionId) => {
        switch (id) {
            case "tokens":
                return <TokenRetentionSection values={draft} onChange={change} />;
            case "activity":
                return <ActivitySection values={draft} onChange={change} />;
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
                {/* The card is overflow-visible, so its rounded corner does not clip the
                    sidebar's background; the sidebar rounds that corner itself. */}
                <TabList
                    tabs={tabs}
                    aria-label="Settings sections"
                    className="w-full md:w-64 shrink-0 bg-app-bg border-b md:border-b-0 md:border-r md:rounded-bl-lg border-border py-4 flex flex-col gap-1"
                >
                    {SECTIONS.map((section) => (
                        <SideTab
                            key={section.id}
                            tabs={tabs}
                            value={section.id}
                            icon={section.icon}
                            trailing={
                                isDirty(section, draft, saved) && (
                                    <>
                                        <span aria-hidden="true" className="w-2 h-2 rounded-full bg-warning" />
                                        <span className="sr-only">(unsaved changes)</span>
                                    </>
                                )
                            }
                        >
                            {section.label}
                        </SideTab>
                    ))}
                </TabList>

                <div className="flex-1 min-w-0 flex flex-col">
                    {SECTIONS.map((section) => (
                        <TabPanel
                            key={section.id}
                            tabs={tabs}
                            value={section.id}
                            className="flex-1 flex flex-col px-8 pt-8 pb-4 animate-in fade-in slide-in-from-right-2 duration-300"
                        >
                            <div className="flex-1 flex flex-col gap-8">
                                {renderSection(section.id)}

                                <div className="mt-auto flex justify-end border-t border-border pt-4">
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
