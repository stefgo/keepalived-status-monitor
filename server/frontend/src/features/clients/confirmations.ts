import { Client, CONNECTION_MODE } from "@kasm/shared";
import type { ConfirmOptions } from "@stefgo/react-ui-components";
import { clientName } from "../../utils";

/**
 * What goes with the row is the server's side only: the client's last keepalived reading is
 * deleted with it. Nothing on the host changes, and the agent keeps running
 * with credentials the server no longer accepts -- the part an operator does not expect,
 * and so the part spelled out.
 */
export function describeDeleteClient(client: Client): ConfirmOptions {
    return {
        title: `Delete "${clientName(client)}"?`,
        description:
            (client.connectionMode === CONNECTION_MODE.OUTBOUND
                ? "The server stops connecting to this host and forgets it, together with its last keepalived reading."
                : "The server forgets this host, together with its last keepalived reading, and refuses its agent from now on.") +
            " keepalived on the host is not touched. To monitor the host again, its agent has to be registered anew.",
        confirmLabel: "Delete client",
        variant: "danger",
    };
}

export function describeDiscardChanges(): ConfirmOptions {
    return {
        title: "Discard your changes?",
        description: "The client has not been saved. Leaving now keeps it as it was.",
        confirmLabel: "Discard",
        cancelLabel: "Keep editing",
        variant: "danger",
    };
}
