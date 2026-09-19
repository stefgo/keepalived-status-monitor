import { MoreVertical, Edit, RefreshCw } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { Client, CLIENT_STATUS, CONNECTION_MODE } from "@kasm/shared";
import { clientName, describeFailure, formatDate } from "../../../utils";
import { useEscapeToLeave } from "../../../hooks/useEscapeToLeave";
import { useKeepalivedStore } from "../../../stores/useKeepalivedStore";
import {
    ActionButton,
    ActionMenu,
    Badge,
    EntityHeader,
    type EntityDetail,
    useActionMenu,
    useConfirm,
} from "@stefgo/react-ui-components";
import { StatusDot } from "./StatusDot";
import { MENU_ENTRY } from "../../../components/menuEntry";
import { ClientKeepalivedPanel } from "../../keepalived/components/ClientKeepalivedPanel";
import { summarizeKeepalived } from "../../keepalived/lib/vrrp";

interface ClientOverviewProps {
    client: Client;
}

export const ClientOverview = ({ client }: ClientOverviewProps) => {
    const navigate = useNavigate();
    const { pathname, state } = useLocation();
    // The list is the only surface that opens this page today, and the honest fallback for
    // a directly opened URL -- the same `from` convention the editor reached from here uses.
    const back = (state as { from?: string } | null)?.from ?? "/clients";
    const reading = useKeepalivedStore((s) => s.states[client.id]);
    const refresh = useKeepalivedStore((s) => s.refresh);
    const { menuState, triggerRef, openMenu, closeMenu } = useActionMenu<string>();
    const { alert } = useConfirm();

    const handleReloadClient = async () => {
        try {
            await refresh(client.id);
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
     * What the header row has no room for. keepalived's state stays on screen; the rest
     * opens on request.
     */
    const details: EntityDetail[] = [
        { label: "keepalived", value: keepalived, visibility: "always" },
        { label: "Instances", value: summary ? String(summary.instances) : "–", visibility: "always" },
        { label: "MASTER", value: summary ? String(summary.masters) : "–", visibility: "always" },
        { label: "FAULT", value: summary ? String(summary.faults) : "–", visibility: "always" },
        { label: "ID", value: client.id, copyable: client.id },
        { label: "Agent", value: client.version || "Unknown" },
        isInbound
            ? { label: "Allowed IP", value: client.inboundAllowedIp || "Any" }
            : { label: "Target Address", value: client.outboundTargetAddress || "–" },
        ...(isInbound && client.inboundLastIp
            ? [{ label: "Last IP", value: client.inboundLastIp }]
            : []),
        { label: "Last Reading", value: reading ? formatDate(reading.collectedAt, { seconds: true }) : "–" },
        ...(isOnline ? [] : [{ label: "Last Seen", value: formatDate(client.lastSeen) }]),
    ];

    return (
        <div className="space-y-6">
            <EntityHeader
                leading={<StatusDot online={isOnline} size="md" />}
                title={clientName(client)}
                meta={
                    <>
                        <Badge variant="info">{isInbound ? "Inbound" : "Outbound"}</Badge>
                        {!isOnline && <Badge variant="warning">Offline</Badge>}
                        {summary && summary.faults > 0 && (
                            <Badge variant="error">{summary.faults} FAULT</Badge>
                        )}
                    </>
                }
                alert={reading?.error && <p className="text-error text-sm">{reading.error}</p>}
                details={details}
                // Names the view, not the client: one entry for every client page.
                persist={{ key: "kasm.client.details", scope: "local" }}
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
                            <button
                                disabled={!isOnline}
                                onClick={() => {
                                    void handleReloadClient();
                                    closeMenu();
                                }}
                                className={MENU_ENTRY}
                            >
                                <RefreshCw size={16} /> Read keepalived now
                            </button>
                            <button
                                onClick={() => {
                                    // `from` is how the editor knows that back is this
                                    // page and not the client list.
                                    navigate(`/client/${client.id}/edit`, {
                                        state: { from: pathname },
                                    });
                                    closeMenu();
                                }}
                                className={MENU_ENTRY}
                            >
                                <Edit size={16} /> Edit
                            </button>
                        </ActionMenu>
                    </div>
                }
            />

            <ClientKeepalivedPanel state={reading ?? null} online={isOnline} />
        </div>
    );
};
