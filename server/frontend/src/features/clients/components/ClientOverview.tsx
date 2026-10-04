import { MoreVertical, Edit, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Client, CLIENT_STATUS, CONNECTION_MODE } from "@kasm/shared";
import { clientName, describeFailure } from "../../../utils";
import { RelativeTime } from "../../../components/RelativeTime";
import { useBackPath } from "../../../hooks/useBackPath";
import { useEscapeToLeave } from "../../../hooks/useEscapeToLeave";
import { refreshKeepalived, useKeepalivedState } from "../../../queries/keepalived";
import {
    ActionButton,
    ActionMenu,
    Badge,
    EntityHeader,
    type EntityDetail,
    useActionMenu,
    useConfirm,
    StatusDot,
    MenuItem,
} from "@stefgo/react-ui-components";
import { HeaderBreadcrumb } from "../../app/HeaderBreadcrumb";
import { ENTITY_HEADER } from "../../../components/entityHeader";
import { ClientKeepalivedPanel } from "../../keepalived/components/ClientKeepalivedPanel";
import { summarizeKeepalived } from "../../keepalived/lib/vrrp";
import { paths } from "../../../lib/paths";
import { STORAGE_KEYS } from "../../../lib/storageKeys";

interface ClientOverviewProps {
    client: Client;
}

export const ClientOverview = ({ client }: ClientOverviewProps) => {
    const navigate = useNavigate();
    // The client list, wherever this page was opened from: its parent in the route tree.
    const back = useBackPath();
    const reading = useKeepalivedState(client.id);
    const { menuState, triggerRef, openMenu, closeMenu } = useActionMenu<string>();
    const { alert } = useConfirm();

    const handleReloadClient = async () => {
        try {
            await refreshKeepalived(client.id);
        } catch (e: unknown) {
            await alert(describeFailure("The agent could not be asked for a reading", e));
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
     * reading stay on screen; the rest opens on request. An offline client shows none of
     * it: the Offline badge says all there is to say.
     */
    const details: EntityDetail[] = isOnline ? [
        { label: "ID", value: client.id, copyable: client.id },
        { label: "Agent", value: client.version || "Unknown" },
        isInbound
            ? { label: "Allowed IP", value: client.inboundAllowedIp || "Any" }
            : { label: "Target Address", value: client.outboundTargetAddress || "–" },
        ...(isInbound && client.inboundLastIp
            ? [{ label: "Last IP", value: client.inboundLastIp }]
            : []),
        { label: "keepalived", value: keepalived, visibility: "always" },
        {
            label: "Last Reading",
            value: reading ? <RelativeTime date={reading.collectedAt} seconds /> : "–",
            visibility: "always",
        },
    ] : [];

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

            {isOnline && <ClientKeepalivedPanel clientId={client.id} state={reading ?? null} />}
        </div>
    );
};
