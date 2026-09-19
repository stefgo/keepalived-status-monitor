import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { ActionButton, Button, cn, FOCUS_RING, Modal } from "@stefgo/react-ui-components";
import { formatDate } from "../../../utils";

interface TokenModalProps {
    token: string;
    expiresAt: string;
    onClose: () => void;
}

/**
 * The registration token, shown the one time it exists in the clear.
 *
 * Escape and a click beside the dialog are both refused: dismissing it is not a way out
 * here, it is losing the value the whole flow was for. The button below is the way out, and
 * it is the only one — which is exactly the case the library's `closeOnEscape` exists for.
 */
export const TokenModal = ({ token, expiresAt, onClose }: TokenModalProps) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        await navigator.clipboard.writeText(token);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <Modal
            isOpen
            onClose={onClose}
            title="New Registration Token"
            description="Copy it now — it is not shown again."
            size="lg"
            closeOnEscape={false}
            closeOnOverlayClick={false}
            hideCloseButton
            footer={
                <Button variant="primary" onClick={onClose} className="w-full">
                    Close
                </Button>
            }
        >
            <div className="p-6 space-y-4">
                <div className="flex items-center gap-2">
                    <input
                        type="text"
                        readOnly
                        value={token}
                        onClick={(e) => (e.target as HTMLInputElement).select()}
                        className={cn(
                            "flex-1 bg-app-bg p-3 rounded-lg border border-border font-mono text-sm text-primary",
                            FOCUS_RING,
                        )}
                    />
                    {/* `color` sets the hover colour as well, so without it the green
                        confirmation would only last while the pointer stays put. */}
                    <ActionButton
                        icon={copied ? Check : Copy}
                        size="lg"
                        variant="solid"
                        color={copied ? "green" : "gray"}
                        tooltip={copied ? "Copied!" : "Copy to clipboard"}
                        onClick={handleCopy}
                        className={copied ? "text-success" : undefined}
                    />
                </div>

                <div className="text-xs text-text-muted">
                    Expires: {formatDate(expiresAt)}
                </div>
            </div>
        </Modal>
    );
};
