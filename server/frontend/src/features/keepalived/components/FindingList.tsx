import { AlertCircle, AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";
import { FOCUS_RING, cn } from "@stefgo/react-ui-components";
import { clusterPath } from "../../../lib/paths";
import type { FleetFinding } from "../lib/clusterFindings";
import { clusterLabel, type NamedVrrpCluster } from "../lib/vrrp";

interface FindingListProps {
    findings: readonly FleetFinding[];
    /** Every cluster, for the path of each finding's own. */
    clusters: NamedVrrpCluster[];
}

/**
 * What is wrong, one finding per line, errors in red, as sadm lists its issues. The cluster
 * leads each line and links to its page, where the members' table says the rest.
 */
export const FindingList = ({ findings, clusters }: FindingListProps) => (
    <ul className="divide-y divide-border">
        {findings.map((finding, index) => {
            const Icon = finding.severity === "error" ? AlertCircle : AlertTriangle;
            const path = clusterPath(finding.cluster, clusters);
            const label = clusterLabel(finding.cluster);
            return (
                <li key={`${finding.cluster.key}-${index}`} className="flex items-start gap-3 px-4 py-3">
                    <Icon
                        size={16}
                        className={cn("mt-0.5 shrink-0", finding.severity === "error" ? "text-error" : "text-warning")}
                        aria-label={finding.severity}
                    />
                    <span className="min-w-0 text-sm text-text-primary">
                        {path ? (
                            <Link to={path} className={cn("rounded-sm font-medium hover:text-primary", FOCUS_RING)}>
                                {label}
                            </Link>
                        ) : (
                            <span className="font-medium">{label}</span>
                        )}
                        : {finding.text}
                    </span>
                </li>
            );
        })}
    </ul>
);
