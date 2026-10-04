import { MoreVertical, Edit, RefreshCw, WifiOff } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Client, CLIENT_STATUS, CONNECTION_MODE } from "@kasm/shared";
import { clientName, formatDate, getErrorMessage } from "../../../utils";
import { RelativeTime } from "../../../components/RelativeTime";
import { useBackPath } from "../../../hooks/useBackPath";
import { useEscapeToLeave } from "../../../hooks/useEscapeToLeave";
import { refreshKeepalived, useKeepalivedState } from "../../../queries/keepalived";
import {
    ActionButton,
    ActionMenu,
    Badge,
    EntityHeader,
    FOCUS_RING,
    cn,
    type EntityDetail,
    useActionMenu,
    useToast,
    StatusDot,
    MenuItem,
} from "@stefgo/react-ui-components";
import { HeaderBreadcrumb } from "../../app/HeaderBreadcrumb";
import { ENTITY_HEADER } from "../../../components/entityHeader";
import { ClientKeepalivedPanel } from "../../keepalived/components/ClientKeepalivedPanel";
import { useVrrpClusters } from "../../keepalived/hooks/useVrrpClusters";
import { clusterLabel, summarizeKeepalived } from "../../keepalived/lib/vrrp";
import { offlineNotice } from "../lib/offlineNotice";
import { clusterPath, paths } from "../../../lib/paths";
import { STORAGE_KEYS } from "../../../lib/storageKeys";

interface ClientOverviewProps {
    client: Client;
}

export const ClientOverview = ({ client }: ClientOverviewProps) => {
    const navigate = useNavigate();
    // The client list, wherever this page was opened from: its parent in the route tree.
    const back = useBackPath();
    const reading = useKeepalivedState(client.id);
    const clusters = useVrrpClusters();
    const { menuState, triggerRef, openMenu, closeMenu } = useActionMenu<string>();
    const { show } = useToast();

    const handleReloadClient = async () => {
        try {
            await refreshKeepalived(client.id);
            show({ variant: "success", title: `Asked ${clientName(client)} for a reading` });
        } catch (e: unknown) {
            show({
                variant: "error",
                title: `Could not reload ${clientName(client)}`,
                description: getErrorMessage(e),
            });
        }
    };

    // The client editor is a route of its own and handles its own Escape.
    useEscapeToLeave(back);

    const isOnline = client.status === CLIENT_STATUS.ONLINE;
    const isInbound = client.connectionMode !== CONNECTION_MODE.OUTBOUND;

    const summary = reading ? summarizeKeepalived(reading) : null;
    const keepalived = reading
        ? [summary?.status, reading.version && `v${reading.version}`, reading.pid && `PID ${reading.pid}`]
              .filter(Boolean)
              .join(" · ")
        : "–";

    /**
     * What the header row has no room for. keepalived's state and the time of the last
     * reading stay on screen while the client is connected; who the client is opens on
     * request, connected or not. An offline client shows no keepalived state: the last one
     * would read as current, and the notice below says how old it is.
     */
    const details: EntityDetail[] = [
        { label: "ID", value: client.id, copyable: client.id },
        { label: "Agent", value: client.version || "Unknown" },
        isInbound
            ? { label: "Allowed IP", value: client.inboundAllowedIp || "Any" }
            : { label: "Target Address", value: client.outboundTargetAddress || "–" },
        ...(isInbound && client.inboundLastIp
            ? [{ label: "Last IP", value: client.inboundLastIp }]
            : []),
        ...(isOnline
            ? [
                  { label: "keepalived", value: keepalived, visibility: "always" as const },
                  {
                      label: "Last Reading",
                      value: reading ? <RelativeTime date={reading.collectedAt} seconds /> : "–",
                      visibility: "always" as const,
                  },
              ]
            : [{ label: "Last Seen", value: formatDate(client.lastSeen) }]),
    ];

    const notice = offlineNotice({ lastSeen: client.lastSeen, readingAt: reading?.collectedAt });
    // Where the last reading is still on screen: dimmed, beside the hosts that report.
    const memberOf = clusters
        .filter((cluster) => cluster.members.some((member) => member.clientId === client.id))
        .flatMap((cluster) => {
            const to = clusterPath(cluster, clusters);
            return to ? [{ key: cluster.key, label: clusterLabel(cluster), to }] : [];
        });

    return (
        <div className="space-y-6">
            <EntityHeader
                leading={<StatusDot tone={isOnline ? "success" : "neutral"} size="md" />}
                title={<HeaderBreadcrumb>{`${client.site ? `${client.site} / ` : ""}${clientName(client)}`}</HeaderBreadcrumb>}
                classNames={ENTITY_HEADER}
                meta={
                    <>
                        <Badge variant="info">{isInbound ? "Inbound" : "Outbound"}</Badge>
                        {!isOnline && <Badge variant="warning">Offline</Badge>}
                        {isOnline && reading && !reading.running && (
                            <Badge variant="warning">No keepalived running</Badge>
                        )}
                        {isOnline && summary && summary.faults > 0 && (
                            <Badge variant="error">{summary.faults} FAULT</Badge>
                        )}
                    </>
                }
                alert={reading?.error && <p className="text-error text-sm">{reading.error}</p>}
                details={details}
                // Names the view, not the client: one entry for every client page.
                persist={{ key: STORAGE_KEYS.clientDetails, scope: "local" }}
                actions={
                    <div className="relative">
                        <ActionButton
                            icon={MoreVertical}
                            aria-label="Client actions"
                            onClick={(e) => openMenu(e, client.id)}
                        />
                        <ActionMenu
                            isOpen={menuState?.id === client.id}
                            onClose={closeMenu}
                            anchor={menuState?.anchor ?? null}
                            triggerRef={triggerRef}
                        >
                            <MenuItem
                                icon={RefreshCw}
                                disabled={!isOnline}
                                onClick={() => void handleReloadClient()}
                            >
                                Read keepalived now
                            </MenuItem>
                            <MenuItem
                                icon={Edit}
                                onClick={() => navigate(paths.clientEdit(client.id))}
                            >
                                Edit
                            </MenuItem>
                        </ActionMenu>
                    </div>
                }
            />

            {/* An offline client shows no instances: the last reading would read as current.
                It says so instead, or the page reads as a broken one. */}
            {isOnline ? (
                <ClientKeepalivedPanel clientId={client.id} state={reading ?? null} />
            ) : (
                <div role="status" className="flex gap-3 rounded-md border border-border bg-card p-4">
                    <WifiOff size={18} className="mt-0.5 shrink-0 text-warning" />
                    <div className="min-w-0">
                        <div className="font-medium text-text-primary">{notice.title}</div>
                        {notice.lines.map((line) => (
                            <p key={line} className="mt-1 text-sm text-text-muted">{line}</p>
                        ))}
                        {memberOf.length > 0 && (
                            <p className="mt-1 text-sm text-text-muted">
                                {memberOf.length === 1 ? "Its cluster still lists" : "Its clusters still list"} it
                                with that reading:{" "}
                                {memberOf.map((cluster, i) => (
                                    <span key={cluster.key}>
                                        {i > 0 && ", "}
                                        <Link
                                            to={cluster.to}
                                            className={cn("rounded-sm text-text-primary hover:text-primary", FOCUS_RING)}
                                        >
                                            {cluster.label}
                                        </Link>
                                    </span>
                                ))}
                                .
                            </p>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};
