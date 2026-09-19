import { cn, FOCUS_RING_NONE } from "@stefgo/react-ui-components";

/**
 * An entry of a detail page's action menu. It marks focus with its background, the way the
 * menu's own entries do -- a ring inside the popover would be clipped by it.
 *
 * Shared, so every detail page greys out a disabled entry the same way.
 */
export const MENU_ENTRY = cn(
    "w-full text-left px-4 py-2 text-sm text-text-primary hover:bg-hover focus-visible:bg-hover flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed",
    FOCUS_RING_NONE,
);
