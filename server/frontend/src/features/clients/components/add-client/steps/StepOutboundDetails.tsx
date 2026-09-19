import { DEFAULT_AGENT_PORT } from "@kasm/shared";
import { Input } from "@stefgo/react-ui-components";
import { AddClientForm } from "../useAddClientForm";

/**
 * Where the server dials and what it authenticates with. Unlike the inbound branch this
 * step has an effect the moment it finishes: the server registers itself with the agent and
 * opens the session, and the client is stored only if that works.
 */
export const StepOutboundDetails = ({ form }: { form: AddClientForm }) => (
    <div className="space-y-6">
        <p className="text-sm text-text-muted">
            The server connects to the agent. Set{" "}
            <code className="bg-hover px-1 rounded">registrationSecret</code> in the agent's{" "}
            <code className="bg-hover px-1 rounded">config.yaml</code> and restart it before
            finishing this step — the agent removes the value once registration succeeds.
        </p>

        <Input
            label="Hostname (optional)"
            value={form.hostname}
            onChange={(e) => form.setHostname(e.target.value)}
            placeholder="lb-01"
            hint="Display name — defaults to the target address if left empty."
        />

        <Input
            label="Target Address"
            value={form.targetAddress}
            onChange={(e) => form.setTargetAddress(e.target.value)}
            onBlur={() => form.touch("targetAddress")}
            placeholder={`192.168.1.100:${DEFAULT_AGENT_PORT}`}
            error={
                form.targetAddressInvalid
                    ? "Enter a host or host:port, without scheme, path or credentials."
                    : form.missing.targetAddress
                      ? "Enter a target address"
                      : undefined
            }
            hint={`Host and port of the agent's web server. Without a port, :${DEFAULT_AGENT_PORT} is used.`}
            required
        />

        <Input
            label="Registration Secret"
            value={form.registrationSecret}
            onChange={(e) => form.setRegistrationSecret(e.target.value)}
            onBlur={() => form.touch("registrationSecret")}
            error={form.missing.registrationSecret ? "Enter the registration secret" : undefined}
            placeholder="the value of registrationSecret in the agent's config.yaml"
            hint="Must match registrationSecret in the agent's config.yaml."
            required
        />
    </div>
);
