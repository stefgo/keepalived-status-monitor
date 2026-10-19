import { Checkbox, Input } from "@stefgo/react-ui-components";
import { AddClientForm } from "../useAddClientForm";

/**
 * The client that is created at once and waits for its agent, with the token the agent
 * registers with. The name is required; without an address, the one the agent registers
 * from becomes its allowed address.
 */
export const StepInboundDetails = ({ form }: { form: AddClientForm }) => (
    <div className="space-y-6">
        <p className="text-sm text-text-muted">
            The client is added now and waits for its agent. The token you get next
            registers the agent under it.
        </p>

        <Input
            label="Display Name"
            value={form.displayName}
            onChange={(e) => form.setDisplayName(e.target.value)}
            onBlur={() => form.touch("displayName")}
            placeholder="lb-01"
            error={form.missing.displayName ? "Enter a display name" : undefined}
            hint="What the client is listed as. The agent reports its hostname when it registers."
            required
        />

        <div className="space-y-4">
            <Checkbox
                label="Restrict connections to an IP address or network"
                checked={form.restrictIp}
                onChange={(e) => form.setRestrictIp(e.target.checked)}
            />
            <p className="text-xs text-text-muted -mt-2 ml-6">
                {form.restrictIp
                    ? "The agent is refused when it connects from anywhere else."
                    : "The client is bound to the address it registers from. You can widen that to a network or switch the check off later in the client editor."}
            </p>

            {form.restrictIp && (
                <Input
                    label="Allowed IP or Network"
                    value={form.allowedIp}
                    onChange={(e) => form.setAllowedIp(e.target.value)}
                    onBlur={() => form.touch("allowedIp")}
                    placeholder="192.168.1.50 or 192.168.1.0/24"
                    error={
                        form.allowedIpInvalid
                            ? "Enter an IPv4 address or an IPv4 network in CIDR notation."
                            : form.missing.allowedIp
                              ? "Enter an IP address or network"
                              : undefined
                    }
                    hint="Set this when you already know where the agent will sit."
                    required
                />
            )}
        </div>
    </div>
);
