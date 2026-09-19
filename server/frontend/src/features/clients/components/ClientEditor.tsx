import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Client, UpdateClient } from "@kasm/shared";
import { X } from "lucide-react";
import { ActionButton, useConfirm } from "@stefgo/react-ui-components";
import { useClientStore } from "../../../stores/useClientStore";
import { ClientIdentityCard } from "./ClientIdentityCard";
import { describeDiscardChanges } from "../confirmations";

interface ClientEditorProps {
    client: Client;
    onSave: (id: string, data: UpdateClient) => Promise<void>;
}

/**
 * Edits what a client *is*: its name, and the address it is reached at or the addresses it
 * may connect from. A page of its own, at `/client/:clientId/edit`.
 *
 * Leaving is a navigation, and the control for it sits in the card's header -- the one part
 * of the form that is in reach from every scroll position without a floating bar over the
 * content. Where it goes is the caller's business: the client list and the client detail
 * page both open this editor, and `location.state.from` is how each says where back is.
 */
export const ClientEditor = ({ client, onSave }: ClientEditorProps) => {
    const navigate = useNavigate();
    const location = useLocation();
    // A directly opened URL carries no state -- the list is the honest fallback, since it
    // is the surface this client is guaranteed to appear on.
    const back = (location.state as { from?: string } | null)?.from ?? "/clients";

    // The caller may hold a snapshot from when the editor opened; status and version arrive
    // over the socket afterwards, so read the client from the store rather than the prop.
    const live = useClientStore((s) => s.clients.find((c) => c.id === client.id)) ?? client;
    // `useState` setters are referentially stable, so the card can list it in an effect's
    // dependencies without re-running it on every render of this component.
    const [dirty, setDirty] = useState(false);
    const { confirm } = useConfirm();

    /**
     * Leaving used to discard silently under a warning label. It asks now: the exit moved
     * into the header, where it sits a few pixels from the fields it would throw away, and
     * a warning the operator has already scrolled past is no protection at that distance.
     */
    const requestClose = useCallback(async () => {
        if (dirty && !(await confirm(describeDiscardChanges()))) return;
        navigate(back);
    }, [dirty, confirm, navigate, back]);

    // Escape does exactly what the header's button does -- including asking first.
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            // Not while a select, a dialog or an autocomplete is using Escape for itself --
            // this includes the discard confirmation, which closes on its own Escape.
            if (e.defaultPrevented) return;
            requestClose();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [requestClose]);

    return (
        <div className="space-y-6">
            <ClientIdentityCard
                client={live}
                onSave={onSave}
                onDirtyChange={setDirty}
                action={<ActionButton icon={X} tooltip="Close" onClick={requestClose} />}
            />
        </div>
    );
};
