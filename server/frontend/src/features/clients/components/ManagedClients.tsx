import { Plus, Edit, Trash2, RefreshCw } from "lucide-react";
import { Client, CLIENT_STATUS, CONNECTION_MODE } from "@kasm/shared";
import { ClientList } from "./ClientList";
import { apiFetch } from "../../../lib/apiFetch";
import { useKeepalivedStore } from "../../../stores/useKeepalivedStore";
import { Button, DataAction, useConfirm } from "@stefgo/react-ui-components";
import { describeFailure } from "../../../utils";
import { describeDeleteClient } from "../confirmations";

interface ManagedClientsProps {
    clients: Client[];
    onSelect: (client: Client | null) => void;
    onRefresh: () => void;
    /** Resolves once the client is gone, so the dialog can hold its spinner until then; rejects on failure. */
    onDelete: (clientId: string) => Promise<void>;
    /** Opens the add wizard -- its own route, so the URL says what is on screen. */
    onAdd: () => void;
    /** Opens the client editor for this client. */
    onEdit: (client: Client) => void;
}

/**
 * The client list and the one thing only the list can do: delete a client.
 *
 * Everything that opens a form -- add and edit -- is a route of its own and therefore a
 * navigation, not a state flag here. This component used to swap both surfaces in and out
 * of the same `div`, which meant the URL described neither of them and a reload dropped the
 * operator back on the list.
 */
export const ManagedClients = ({
    clients,
    onSelect,
    onRefresh,
    onDelete,
    onAdd,
    onEdit,
}: ManagedClientsProps) => {
    const refresh = useKeepalivedStore((s) => s.refresh);

    const { confirm, alert } = useConfirm();

    // A failed delete keeps the dialog open with the message in it: the store reverts its
    // optimistic removal, so the row comes back, and closing would hide both the failure
    // and the button that retries it.
    const requestDelete = (client: Client) =>
        confirm({ ...describeDeleteClient(client), onConfirm: () => onDelete(client.id) });

    /**
     * Reload means two different things depending on which side dials: an offline outbound
     * client needs a connection attempt before there is anything to read, everything else
     * is asked to read keepalived again.
     */
    const handleReloadClient = async (client: Client) => {
        if (
            client.connectionMode === CONNECTION_MODE.OUTBOUND &&
            client.status === CLIENT_STATUS.OFFLINE
        ) {
            await apiFetch(`/api/v1/clients/${client.id}/reconnect`, {
                method: "POST",
            });
            onRefresh();
            return;
        }

        try {
            await refresh(client.id);
        } catch (e: unknown) {
            await alert(describeFailure("The agent could not be asked for a reading", e));
        }
    };

    return (
        <div id="client-list-section">
            <ClientList
                clients={clients}
                setSelectedClient={onSelect}
                renderRowActions={(client) => (
                    <DataAction
                        rowId={client.id}
                        menuEntries={[
                            {
                                label: "Reload",
                                icon: RefreshCw,
                                onClick: () => handleReloadClient(client),
                                variant: "default",
                            },
                            {
                                label: "Edit",
                                icon: Edit,
                                onClick: () => onEdit(client),
                                variant: "default",
                            },
                            {
                                label: "Delete",
                                icon: Trash2,
                                onClick: () => requestDelete(client),
                                variant: "danger",
                            },
                        ]}
                    />
                )}
                extraActions={
                    <Button size="sm" icon={Plus} onClick={onAdd}>
                        Add Client
                    </Button>
                }
            />

        </div>
    );
};
