import { Monitor } from "lucide-react";
import { ReactNode, useMemo } from "react";
import { useSearchQueryParam } from "../../../hooks/useSearchQueryParam";
import { Client, CLIENT_STATUS } from "@kasm/shared";
import { clientName, EMPTY_VALUE, formatDate } from "../../../utils";
import { PAGE_SIZE, pagination } from "../../../components/listDefaults";
import { StatusDot } from "./StatusDot";
import { DataTableDef } from "@stefgo/react-ui-components";
import { DataListDef, DataListColumnDef } from "@stefgo/react-ui-components";
import { DataMultiView } from "@stefgo/react-ui-components";

/**
 * What the connected agent says it can do, reported as it named it. Only the agent on the
 * wire can answer this -- capabilities belong to the build that is connected -- so an
 * offline client says nothing rather than guessing from a stored version.
 *
 * The cell reports rather than interprets: a capability the dashboard does not know still
 * shows up here, and nothing is turned into a verdict about a single one of them. Where a
 * missing capability calls for an action, the place that asks for it says so.
 */
const CapabilitiesCell = ({ client }: { client: Client }) => {
    if (client.status !== CLIENT_STATUS.ONLINE || client.capabilities == null) {
        return <span className="text-sm text-text-muted">{EMPTY_VALUE}</span>;
    }
    if (client.capabilities.length === 0) {
        return <span className="text-sm text-text-muted">None</span>;
    }
    return (
        <span className="text-sm text-text-primary">{client.capabilities.join(", ")}</span>
    );
};

interface ClientListProps {
    clients: Client[];
    setSelectedClient?: (client: Client | null) => void;
    renderRowActions?: (client: Client) => ReactNode;
    extraActions?: ReactNode;
}

export const ClientList = ({
    clients,
    setSelectedClient,
    renderRowActions,
    extraActions,
}: ClientListProps) => {
    const [searchQuery, setSearchQuery] = useSearchQueryParam();

    const sortedClients = useMemo(
        () => [...clients].sort((a, b) => clientName(a).localeCompare(clientName(b))),
        [clients],
    );

    const filteredClients = useMemo(() => {
        if (!searchQuery) return sortedClients;
        const q = searchQuery.toLowerCase();
        return sortedClients.filter(c =>
            (c.displayName ?? "").toLowerCase().includes(q) ||
            c.hostname.toLowerCase().includes(q) ||
            (c.site ?? "").toLowerCase().includes(q) ||
            c.id.toLowerCase().includes(q),
        );
    }, [sortedClients, searchQuery]);

    const buildTableDefinitions = (): DataTableDef<Client>[] => {
        const cols: DataTableDef<Client>[] = [];

        cols.push({
            tableHeader: "Client",
            sortable: true,
            sortValue: (client) => clientName(client),
            tableItemRender: (client) => (
                <div className="flex items-center gap-3">
                    <StatusDot online={client.status === CLIENT_STATUS.ONLINE} />
                    <div
                        className={`text-sm font-medium text-text-primary ${client.status === CLIENT_STATUS.ONLINE ? "" : "opacity-70"} truncate`}
                    >
                        {clientName(client)}
                    </div>
                </div>
            ),
        });

        cols.push({
            tableHeader: "Site",
            sortable: true,
            sortValue: (client) => client.site ?? "",
            tableCellClassName: "align-top text-sm text-text-primary",
            tableItemRender: (client) => client.site || EMPTY_VALUE,
        });

        cols.push({
            tableHeader: null,
            tableCellClassName: "align-top text-sm text-text-primary",
            tableItemRender: (client) =>
                client.status !== CLIENT_STATUS.ONLINE ? (
                    <div className="whitespace-nowrap opacity-70">
                        Last Seen: {formatDate(client.lastSeen)}
                    </div>
                ) : null,
        });

        if (renderRowActions) {
            cols.push({
                tableHeader: "Actions",
                tableHeaderClassName: "text-center",
                tableCellClassName: "content-center",
                tableItemRender: (client) => (
                    <div onClick={(e) => e.stopPropagation()}>
                        {renderRowActions(client)}
                    </div>
                ),
            });
        }

        return cols;
    };

    const buildListDefinitions = (): DataListColumnDef<Client>[] => {
        const contentFields: DataListDef<Client>[] = [];
        const actionFields: DataListDef<Client>[] = [];

        contentFields.push({
            listItemRender: (client) => (
                <div className="flex items-center gap-2 py-1">
                    <StatusDot online={client.status === CLIENT_STATUS.ONLINE} />
                    <div
                        className={`font-medium text-text-primary ${client.status === CLIENT_STATUS.ONLINE ? "" : "opacity-70"} truncate`}
                    >
                        {clientName(client)}
                    </div>
                </div>
            ),
            listLabel: null,
        });

        contentFields.push({
            accessorKey: "id",
            listLabel: "ID",
        });

        contentFields.push({
            listItemRender: (client) => (
                <span className="text-sm text-text-primary">
                    {client.site || EMPTY_VALUE}
                </span>
            ),
            listLabel: "Site",
        });

        contentFields.push({
            listItemRender: (client) => (
                <span className="text-sm text-text-primary">
                    {client.version}
                </span>
            ),
            listLabel: "Version",
        });

        contentFields.push({
            listItemRender: (client) => <CapabilitiesCell client={client} />,
            listLabel: "Capabilities",
        });

        contentFields.push({
            listItemRender: (client) =>
                client.status !== CLIENT_STATUS.ONLINE ? (
                    <span className="text-sm text-text-muted">
                        {formatDate(client.lastSeen)}
                    </span>
                ) : (
                    <span className="text-success text-sm">
                        Online
                    </span>
                ),
            listLabel: "Status",
        });

        if (renderRowActions) {
            actionFields.push({
                listItemRender: (client) => (
                    <div
                        onClick={(e) => e.stopPropagation()}
                        className="mt-2 md:mt-0 flex justify-center"
                    >
                        {renderRowActions(client)}
                    </div>
                ),
                listLabel: null,
            });
        }

        return actionFields.length > 0
            ? [
                    { fields: contentFields, columnClassName: "flex-1" },
                    { fields: actionFields, columnClassName: "md:text-right" },
                ]
            : [{ fields: contentFields, columnClassName: "flex-1" }];
    };

    const tableColumns = buildTableDefinitions();
    const listColumns = buildListDefinitions();

    return (
        <DataMultiView
            title={
                <>
                    <Monitor size={18} className="text-text-muted" /> Clients
                </>
            }
            extraActions={extraActions}
            sort={{ defaultValue: [{ colIndex: 0, direction: "asc" }] }}
            viewMode={{ persist: { key: "clientViewMode", scope: "local" } }}
            data={filteredClients}
            tableDef={tableColumns}
            listColumns={listColumns}
            keyField="id"
            searchable
            searchPlaceholder="Search name, hostname, site or ID…"
            search={{ value: searchQuery, onChange: setSearchQuery }}
            emptyMessage="No clients connected."
            rowClassName="align-top"
            onRowClick={setSelectedClient ?? undefined}
            // The view owns the page state and takes the page after sorting, so a column
            // sort covers every client, not just the ones on screen.
            pagination={pagination(PAGE_SIZE.page)}
        />
    );
};
