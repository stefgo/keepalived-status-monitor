import { LoaderCircle } from "lucide-react";
import { cn } from "@stefgo/react-ui-components";

interface LoadingIndicatorProps {
    /** What is being waited for. Shown next to the spinner and announced with it. */
    label?: string;
    className?: string;
}

/**
 * "Something is on its way", wherever a view has nothing to show yet.
 *
 * One component for a lazy route, a settings page loading, and a client's first keepalived
 * reading on its way, so waiting looks the same everywhere.
 *
 * `role="status"` so the text is announced when it appears; the spinner itself is
 * decorative and stays out of the accessibility tree.
 */
export const LoadingIndicator = ({
    label = "Loading…",
    className,
}: LoadingIndicatorProps) => (
    <div
        role="status"
        className={cn(
            "flex items-center justify-center gap-2 py-8 text-sm text-text-muted",
            className,
        )}
    >
        <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />
        {label}
    </div>
);
