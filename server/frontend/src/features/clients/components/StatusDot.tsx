import { cn } from "@stefgo/react-ui-components";

interface StatusDotProps {
    /** Whether the thing is live: a connected client. */
    online: boolean;
    /**
     * How the dot looks while it is *not* live -- a background class, plus an animation
     * where the state deserves one. Clients know one such state and take the default.
     */
    idleClassName?: string;
    /** `md` for the detail view's header, `sm` everywhere in a list. */
    size?: "sm" | "md";
    className?: string;
}

/**
 * Whether the server currently holds a connection to a client.
 *
 * One component, so every list, header and cluster table draws "online" the same way.
 *
 * The dot is decorative. Every place that shows it also names the state in text -- an
 * "Online" cell, a "Last seen" column, the client name beside it -- so announcing it again
 * would only repeat what is already there.
 */
export const StatusDot = ({ online, idleClassName = "bg-border", size = "sm", className }: StatusDotProps) => (
    <div
        aria-hidden="true"
        className={cn(
            "rounded-full shrink-0",
            size === "md" ? "w-3 h-3" : "w-2 h-2",
            online ? "bg-success shadow-glow-success animate-pulse-glow" : idleClassName,
            className,
        )}
    />
);
