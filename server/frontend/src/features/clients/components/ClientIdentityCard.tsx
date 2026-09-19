import { ReactNode, useEffect, useState } from "react";
import {
    Client,
    CLIENT_STATUS,
    CONNECTION_MODE,
    DEFAULT_AGENT_PORT,
    Ipv4OrCidrSchema,
    isIpAllowed,
    normaliseTargetAddress,
    UpdateClient,
} from "@kasm/shared";
import { Save } from "lucide-react";
import { Badge, Button, Card, Checkbox, Input } from "@stefgo/react-ui-components";
import { StatusDot } from "./StatusDot";
import { clientName, formatDate, getErrorMessage } from "../../../utils";

interface ClientIdentityCardProps {
    client: Client;
    onSave: (id: string, data: UpdateClient) => Promise<void>;
    /** Reported upwards so the page can ask before the operator leaves with unsaved work. */
    onDirtyChange?: (dirty: boolean) => void;
    /**
     * Placed in the card header. The page passes its close control here rather than
     * rendering one of its own: the header is the one part of a card that stays in reach
     * no matter how far down the form the operator has scrolled.
     */
    action?: ReactNode;
}

/**
 * Name and address of a client -- everything
 * `PUT /api/v1/clients/:id` owns, and nothing else. One save button for one resource is the
 * only arrangement in which a button cannot silently drop what the operator typed into a
 * field it does not submit.
 *
 * The card does not decide what leaving means -- the page does, and hands it in as
 * `action`. Save stays here, because it belongs to these fields; the way out belongs to
 * the surface that opened them.
 */
export const ClientIdentityCard = ({
    client,
    onSave,
    onDirtyChange,
    action,
}: ClientIdentityCardProps) => {
    const isInbound = client.connectionMode !== CONNECTION_MODE.OUTBOUND;
    const [displayName, setDisplayName] = useState(client.displayName || "");
    // The check is opt-out per client: the box carries the decision, the field the value.
    const [restrictIp, setRestrictIp] = useState(!!client.inboundAllowedIp);
    const [allowedIp, setAllowedIp] = useState(client.inboundAllowedIp || "");
    const [targetAddress, setTargetAddress] = useState(client.outboundTargetAddress || "");
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState(false);

    // Same rule the server applies, so a rejected value is caught in the field instead of
    // coming back as a request error. A stored value the schema would not accept -- the
    // IPv6 address a client registered from -- stays savable as long as it is unchanged.
    const allowedIpTrimmed = allowedIp.trim();
    const allowedIpChanged = allowedIpTrimmed !== (client.inboundAllowedIp || "");
    const allowedIpInvalid =
        isInbound &&
        restrictIp &&
        allowedIpChanged &&
        !Ipv4OrCidrSchema.safeParse(allowedIpTrimmed).success;

    /**
     * The agent cannot object to a value that shuts it out, and the mistake only surfaces at
     * its next reconnect -- possibly hours later, by which time an offline client is all
     * there is to go on. The address of its last successful connect is the one piece of
     * evidence available while the field is still open, so the form says outright when the
     * value under the cursor would not let that address back in.
     */
    const wouldLockOut =
        isInbound &&
        restrictIp &&
        !!client.inboundLastIp &&
        !!allowedIpTrimmed &&
        !allowedIpInvalid &&
        !isIpAllowed(client.inboundLastIp, allowedIpTrimmed);

    // Same rule the endpoint applies, from the same function: the field rejects an address
    // the server would reject. A stored value is only re-checked once it is edited, so an
    // address written before this check existed stays savable as long as it is left alone.
    const targetAddressTrimmed = targetAddress.trim();
    const targetAddressChanged =
        targetAddressTrimmed !== (client.outboundTargetAddress || "");
    const targetAddressInvalid =
        !isInbound &&
        targetAddressChanged &&
        normaliseTargetAddress(targetAddressTrimmed) === null;

    // Whether leaving now would throw something away. The page asks before it does.
    const isDirty =
        displayName.trim() !== (client.displayName || "") ||
        allowedIpChanged ||
        restrictIp !== !!client.inboundAllowedIp ||
        targetAddressChanged;

    // Save is offered only when there is something to save: a button that submits an
    // unchanged form teaches the operator to press it and find out.
    const canSave =
        isDirty &&
        !allowedIpInvalid &&
        !targetAddressInvalid &&
        // Required only while the box is ticked: that is what ticking it means.
        !(isInbound && restrictIp && !allowedIpTrimmed) &&
        !(!isInbound && !targetAddressTrimmed);

    useEffect(() => {
        onDirtyChange?.(isDirty);
    }, [isDirty, onDirtyChange]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!canSave) return;
        setIsSaving(true);
        setError(null);
        setSaved(false);
        try {
            const data: UpdateClient = { displayName: displayName.trim() };
            if (isInbound) {
                // Only sent when it changed: an absent key leaves the stored value alone, and
                // `null` is not "unchanged" but "switch the check off".
                if (!restrictIp && client.inboundAllowedIp) {
                    data.inboundAllowedIp = null;
                } else if (restrictIp && allowedIpChanged) {
                    data.inboundAllowedIp = allowedIpTrimmed;
                }
            } else if (targetAddressChanged) {
                data.outboundTargetAddress = targetAddressTrimmed;
            }
            await onSave(client.id, data);
            setSaved(true);
        } catch (err) {
            setError(getErrorMessage(err));
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Card
            className="flex flex-col"
            title={
                <div className="flex items-center gap-4">
                    <StatusDot online={client.status === CLIENT_STATUS.ONLINE} size="md" />
                    <div>
                        <div className="text-xl font-bold">
                            {clientName(client)}
                        </div>
                        {/* The id belongs to the name it identifies, on its own line
                            beneath it. The overview keeps it in its details instead,
                            where there is room to copy it. */}
                        <div className="text-sm font-mono text-text-muted">
                            {client.id}
                        </div>
                        {/* Only while offline: for a connected client the pulsing dot
                            already says the agent is here, and a timestamp beside it just
                            invites the question whether it is stale. */}
                        {client.status !== CLIENT_STATUS.ONLINE && (
                            <div className="text-xs font-normal text-text-muted mt-1">
                                Last seen {formatDate(client.lastSeen)}
                            </div>
                        )}
                    </div>
                </div>
            }
            titleAs="div"
            action={action}
            classNames={{ header: "py-5 px-7" }}
        >
            <div className="px-7 py-6 bg-card">
                <form onSubmit={handleSubmit} className="space-y-6">
                    {/* Read-only, and first: it decides whether there is a target address
                        or an IP restriction below at all, so it reads as context for the
                        fields under it rather than as a footnote after them. */}
                    <div>
                        {/* Not an `Input`: there is no control to label. The classes are
                            copied from its stacked label and hint so a read-only value
                            lines up with the editable fields under it. */}
                        <div className="block text-xs font-bold text-text-muted uppercase mb-1.5 ml-1">
                            Connection Mode
                        </div>
                        {/* `lg` is text-sm -- the size the inputs and the agent version
                            below use, so the read-only value does not read as a footnote. */}
                        <Badge variant="info" size="lg">
                            {isInbound ? "Inbound" : "Outbound"}
                        </Badge>
                        <p className="mt-1 text-xs text-text-muted leading-relaxed ml-1">
                            {isInbound
                                ? "The agent dials the server and keeps the connection open."
                                : "The server dials the agent's web server at the address below."}
                        </p>
                    </div>

                    <div>
                        <div className="block text-xs font-bold text-text-muted uppercase mb-1.5 ml-1">
                            Agent Version
                        </div>
                        {/* Always rendered, even without a value: a field that vanishes reads
                            as "not applicable", while an agent that has never reported one is
                            a fact worth seeing. */}
                        <span className="ml-1 text-sm text-text-primary">
                            {client.version || "Unknown"}
                        </span>
                        {!client.version && (
                            <p className="mt-1 text-xs text-text-muted leading-relaxed ml-1">
                                Reported by the agent on connect -- an agent that has not
                                connected yet has none.
                            </p>
                        )}
                    </div>

                    <Input
                        label="Display Name"
                        value={displayName}
                        onChange={(e) => {
                            setDisplayName(e.target.value);
                            setSaved(false);
                        }}
                        placeholder={client.hostname}
                        disabled={isSaving}
                        hint={`Leave empty to use hostname (${client.hostname})`}
                        autoFocus
                    />

                    {isInbound && (
                        <div className="space-y-4">
                            {/* A Checkbox rather than a Switch: this form is submitted by its
                                save button, and a switch would claim to take effect on the spot. */}
                            <Checkbox
                                label="Restrict connections to an IP address or network"
                                checked={restrictIp}
                                onChange={(e) => {
                                    setRestrictIp(e.target.checked);
                                    setSaved(false);
                                }}
                                disabled={isSaving}
                                hint={
                                    restrictIp
                                        ? "The agent is refused when it connects from anywhere else."
                                        : `The agent's token is accepted from any address the server's allowed_networks permit. Suited to hosts whose address is assigned by their environment.${
                                              client.inboundLastIp
                                                  ? ` Its last successful connection came from ${client.inboundLastIp}.`
                                                  : ""
                                          }`
                                }
                            />

                            {restrictIp && (
                                <Input
                                    label="Allowed IP or Network"
                                    value={allowedIp}
                                    onChange={(e) => {
                                        setAllowedIp(e.target.value);
                                        setSaved(false);
                                    }}
                                    placeholder="192.168.1.50 or 192.168.1.0/24"
                                    disabled={isSaving}
                                    error={
                                        allowedIpInvalid
                                            ? "Enter an IPv4 address or an IPv4 network in CIDR notation."
                                            : undefined
                                    }
                                    hint={
                                        client.inboundLastIp
                                            ? `A client that connects from a different address is refused at its next reconnect. Its last successful connection came from ${client.inboundLastIp}.`
                                            : "A client that connects from a different address is refused at its next reconnect."
                                    }
                                />
                            )}

                            {/* Not the field's `error`: the value is well-formed and storable,
                                and the agent may well have moved on purpose. It is a
                                consequence worth seeing before saving, not a reason to refuse
                                -- an `error` here would block Save and make the operator's
                                decision for them. */}
                            {wouldLockOut && (
                                <p className="text-xs text-error leading-relaxed ml-1">
                                    This value would not let {client.inboundLastIp} back in --
                                    the agent is refused at its next reconnect.
                                </p>
                            )}
                        </div>
                    )}

                    {!isInbound && (
                        <Input
                            label="Target Address"
                            value={targetAddress}
                            onChange={(e) => {
                                setTargetAddress(e.target.value);
                                setSaved(false);
                            }}
                            placeholder={`192.168.1.100:${DEFAULT_AGENT_PORT}`}
                            disabled={isSaving}
                            error={
                                targetAddressInvalid
                                    ? "Enter a host or host:port, without scheme, path or credentials."
                                    : undefined
                            }
                            hint={`Host and port of the agent's web server. Without a port, :${DEFAULT_AGENT_PORT} is used. Saving reconnects to the new address at once.`}
                            required
                        />
                    )}

                    <div className="flex items-center justify-end gap-4 border-t border-border pt-5">
                        {error && <span className="text-sm text-error mr-auto">{error}</span>}
                        {!error && saved && (
                            <span className="text-sm text-success mr-auto">Client saved</span>
                        )}
                        <Button
                            type="submit"
                            variant="primary"
                            isLoading={isSaving}
                            disabled={!canSave}
                            icon={Save}
                            className="shadow-glow-accent"
                        >
                            Save
                        </Button>
                    </div>
                </form>
            </div>
        </Card>
    );
};
