import { ReactNode } from "react";
import type { VrrpInstance } from "@kasm/shared";
import { formatDate } from "../../../utils";
import { formatInterval } from "../lib/vrrp";
import { VrrpStateBadge } from "./VrrpStateBadge";

interface Row {
    key: string;
    instance: VrrpInstance;
    /** Rendered in front of the instance name -- the host, where the table spans several. */
    host?: ReactNode;
    /** Dims a row whose host is offline: its state is the last one reported, not the present one. */
    stale?: boolean;
}

interface VrrpInstanceTableProps {
    rows: Row[];
    showHost?: boolean;
}

const TH = "px-3 py-2 text-left text-xs font-bold uppercase text-text-muted whitespace-nowrap";
const TD = "px-3 py-2 text-sm text-text-primary align-top";

/** VRRP instances in a plain table; scrolls sideways on a narrow screen instead of squeezing. */
export const VrrpInstanceTable = ({ rows, showHost = false }: VrrpInstanceTableProps) => (
    <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-border">
            <thead>
                <tr>
                    {showHost && <th className={TH}>Host</th>}
                    <th className={TH}>Instance</th>
                    <th className={TH}>State</th>
                    <th className={TH}>Interface</th>
                    <th className={TH}>VRID</th>
                    <th className={TH}>Priority</th>
                    <th className={TH}>Advert</th>
                    <th className={TH}>Virtual IPs</th>
                    <th className={TH}>Last transition</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-border">
                {rows.map(({ key, instance, host, stale }) => {
                    const adjusted =
                        instance.effectivePriority !== null &&
                        instance.effectivePriority !== undefined &&
                        instance.effectivePriority !== instance.priority;
                    return (
                        <tr key={key} className={stale ? "opacity-60" : undefined}>
                            {showHost && <td className={TD}>{host}</td>}
                            <td className={`${TD} font-medium`}>
                                {instance.name}
                                {instance.syncGroup && (
                                    <div className="text-xs text-text-muted">
                                        Sync group {instance.syncGroup}
                                    </div>
                                )}
                            </td>
                            <td className={TD}>
                                <VrrpStateBadge state={instance.state} />
                                {instance.wantedState &&
                                    instance.wantedState !== "UNKNOWN" &&
                                    instance.wantedState !== instance.state && (
                                        <div className="text-xs text-text-muted mt-1">
                                            configured {instance.wantedState}
                                        </div>
                                    )}
                            </td>
                            <td className={`${TD} font-mono`}>{instance.interface ?? "–"}</td>
                            <td className={TD}>{instance.vrid ?? "–"}</td>
                            <td className={TD}>
                                {instance.priority ?? "–"}
                                {adjusted && (
                                    <span className="text-text-muted"> → {instance.effectivePriority}</span>
                                )}
                            </td>
                            <td className={TD}>{formatInterval(instance.advertInterval)}</td>
                            <td className={`${TD} font-mono`}>
                                {instance.vips.length > 0
                                    ? instance.vips.map((vip) => <div key={vip}>{vip}</div>)
                                    : "–"}
                            </td>
                            <td className={`${TD} whitespace-nowrap`}>
                                {formatDate(instance.lastTransition, { seconds: true })}
                            </td>
                        </tr>
                    );
                })}
            </tbody>
        </table>
    </div>
);
