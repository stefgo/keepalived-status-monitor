import { ReactNode, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button, Input, useConfirm } from "@stefgo/react-ui-components";
import { describeFailure } from "../../../utils";

/**
 * The heading of a settings section: what it controls, in a sentence or two. The fields
 * fill the panel's width; running text is held to a readable line length instead.
 */
export const SectionHeader = ({ title, children }: { title: string; children: ReactNode }) => (
    <div className="mb-6">
        <h3 className="text-lg font-bold text-text-primary flex items-center gap-2">{title}</h3>
        <p className="text-sm text-text-muted max-w-prose">{children}</p>
    </div>
);

/** The small uppercase caption above a field or a read-only value. */
export const FieldCaption = ({ children }: { children: ReactNode }) => (
    <p className="block text-xs font-bold text-text-muted uppercase mb-1">{children}</p>
);

interface NumberFieldProps {
    label: string;
    value: string;
    onChange: (value: string) => void;
    /** The lowest value accepted; anything below, or nothing at all, becomes this. */
    min?: number;
    placeholder?: string;
    hint: ReactNode;
}

/**
 * A whole number, stored as a string like every setting. Every section had this label,
 * field and hint written out by hand, with the clamping repeated in each onChange.
 */
export const NumberField = ({ label, value, onChange, min = 0, placeholder, hint }: NumberFieldProps) => (
    <div>
        <label className="block text-xs font-bold text-text-muted uppercase mb-1">{label}</label>
        <Input
            type="number"
            min={String(min)}
            value={value}
            onChange={(e) => onChange(Math.max(min, parseInt(e.target.value) || min).toString())}
            placeholder={placeholder}
        />
        <p className="text-xs text-text-muted leading-relaxed max-w-prose">{hint}</p>
    </div>
);

interface ManualRunBoxProps {
    description: string;
    /** Runs the job and returns what the button shows for a moment afterwards. Throws on failure. */
    onRun: () => Promise<string>;
    /** The title of the notice a failure is reported in. */
    failureTitle: string;
    /** Room for the longest result the job can report. */
    buttonClassName?: string;
}

/**
 * "Run the job now", below the settings that shape it. The button spins while the job runs,
 * then shows its result for three seconds. Four sections kept a copy of this each, with a
 * pair of state variables and a timer effect per copy.
 */
export const ManualRunBox = ({ description, onRun, failureTitle, buttonClassName = "w-[160px]" }: ManualRunBoxProps) => {
    const { alert } = useConfirm();
    const [isRunning, setIsRunning] = useState(false);
    const [result, setResult] = useState<string | null>(null);

    useEffect(() => {
        if (!result) return;
        const timer = setTimeout(() => setResult(null), 3000);
        return () => clearTimeout(timer);
    }, [result]);

    const run = async () => {
        setIsRunning(true);
        try {
            setResult(await onRun());
        } catch (e: unknown) {
            alert(describeFailure(failureTitle, e));
        } finally {
            setIsRunning(false);
        }
    };

    return (
        <div className="mt-8 p-4 bg-hover rounded-xl border border-border flex items-center justify-between gap-4">
            <div>
                <h4 className="text-sm font-bold text-text-primary">Manual Run</h4>
                <p className="text-xs text-text-muted">{description}</p>
            </div>
            <Button
                variant="secondary"
                onClick={run}
                disabled={isRunning || !!result}
                className={buttonClassName}
            >
                {isRunning ? (
                    <RefreshCw size={16} className="animate-spin" />
                ) : result ? (
                    <span className="animate-in zoom-in duration-300">{result}</span>
                ) : (
                    <span>Run Now</span>
                )}
            </Button>
        </div>
    );
};
