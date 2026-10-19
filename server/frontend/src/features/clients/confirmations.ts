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

/**
 * Before a new registration token is issued for a client whose agent is registered. Nothing
 * changes yet -- the risk is in what comes next: the first agent that registers with the
 * token takes the client over, and the one connected now is cut off at that moment.
 */
export function describeReregister(client: Client): ConfirmOptions {
    return {
        title: `Register a new agent for "${clientName(client)}"?`,
        description:
            "A new registration token is issued for this client. The agent connected now keeps working until an agent registers with the token; from then on only that agent is accepted, under the same client with its settings and history. Use this after reinstalling the agent or moving it to another host.",
        confirmLabel: "Generate token",
    };
}
