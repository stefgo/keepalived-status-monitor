import { mismatchedVips } from "@kasm/shared";
import type { NamedClusterMember, NamedVrrpCluster } from "./vrrp";

export type FindingSeverity = "error" | "warning";

/** One thing that is wrong with a cluster, in a sentence. */
export interface ClusterFinding {
    severity: FindingSeverity;
    text: string;
}

const isLive = (member: NamedClusterMember) => member.online && member.reporting;

/**
 * What is wrong with a cluster, one finding per thing. Counted as the cluster's health is
 * (`healthOf` in `shared`), so the two cannot disagree: a healthy cluster has none, a degraded
 * one has a warning, and one whose badge is red has an error. That is why an agent that is
 * offline is a finding here, while the incidents leave it out.
 *
 * Errors come first.
 */
export function clusterFindings(cluster: NamedVrrpCluster): ClusterFinding[] {
    const findings: ClusterFinding[] = [];
    const live = cluster.members.filter(isLive);
    const masters = live.filter((member) => member.instance.state === "MASTER");

    if (live.length > 0 && masters.length > 1) {
        findings.push({
            severity: "error",
            text: `Split brain: ${masters.map((member) => member.hostName).join(", ")} are MASTER`,
        });
    } else if (live.length > 0 && masters.length === 0) {
        findings.push({ severity: "error", text: "No host is MASTER" });
    }

    // Like `healthOf`, over every member: a statement about the configuration.
    for (const { member, missing } of mismatchedVips(cluster.members)) {
        findings.push({ severity: "error", text: `${member.hostName} lacks ${missing.join(", ")}` });
    }

    for (const member of cluster.members) {
        const last = member.instance.state;
        if (!member.online) {
            findings.push({ severity: "warning", text: `${member.hostName}: agent offline, last ${last}` });
        } else if (!member.reporting) {
            findings.push({ severity: "warning", text: `${member.hostName}: keepalived not reporting, last ${last}` });
        } else if (last === "FAULT") {
            findings.push({ severity: "warning", text: `${member.hostName} in FAULT` });
        }
    }

    if (cluster.members.length < 2) {
        findings.push({ severity: "warning", text: "Only one host in the cluster" });
    }

    return findings;
}

/** A finding together with the cluster it is about. */
export interface FleetFinding extends ClusterFinding {
    cluster: NamedVrrpCluster;
}

/**
 * Every finding across the fleet: the errors of every cluster first, then the warnings, each
 * in the order the clusters come in -- which puts the worst cluster on top.
 */
export function fleetFindings(clusters: readonly NamedVrrpCluster[]): FleetFinding[] {
    const all = clusters.flatMap((cluster) => clusterFindings(cluster).map((finding) => ({ ...finding, cluster })));
    return [...all.filter((f) => f.severity === "error"), ...all.filter((f) => f.severity === "warning")];
}
