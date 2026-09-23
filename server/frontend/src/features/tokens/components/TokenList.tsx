import { useMemo } from "react";
import { Key, Trash2 } from "lucide-react";
import { Token } from "@kasm/shared";
import {
    Badge,
    DataAction,
    DataListColumnDef,
    DataListDef,
    DataMultiView,
    DataTableDef,
} from "@stefgo/react-ui-components";
import { formatDate } from "../../../utils";
import { useSearchQueryParam } from "../../../hooks/useSearchQueryParam";
import { PAGE_SIZE, pagination } from "../../../components/listDefaults";

interface TokenListProps {
    tokens: Token[];
    isLoading: boolean;
    deleteToken: (token: Token) => void;
}

const isExpired = (t: Token) => new Date(t.expiresAt) < new Date();

const TokenValue = ({ token: t }: { token: Token }) => (
    <span
        className={`font-mono text-sm text-text-primary break-all ${t.usedAt || isExpired(t) ? "line-through opacity-60" : ""}`}
    >
        {t.token}
    </span>
);

/**
 * What the token fixes for the client it creates. A token issued before these existed
 * carries neither, and says so rather than showing blanks.
 */
const ClientDefaults = ({ token: t }: { token: Token }) => {
    if (!t.displayName && !t.inboundAllowedIp) {
        return <span className="text-sm text-text-muted opacity-60">From the agent</span>;
    }
    return (
        <div className="text-sm text-text-muted">
            {t.displayName && <div className="text-text-primary">{t.displayName}</div>}
            {t.inboundAllowedIp && <div className="font-mono text-xs">{t.inboundAllowedIp}</div>}
        </div>
    );
};

const Validity = ({ token: t }: { token: Token }) => {
    if (t.usedAt) return <>Used: {formatDate(t.usedAt)}</>;
    if (isExpired(t)) return <>Expired: {formatDate(t.expiresAt)}</>;
    return <>Expires: {formatDate(t.expiresAt)}</>;
};

const StatusBadge = ({ token: t }: { token: Token }) => {
    if (t.usedAt) return <Badge variant="neutral" size="sm">Used</Badge>;
    if (isExpired(t)) return <Badge variant="error" size="sm">Expired</Badge>;
    return <Badge variant="success" size="sm">Active</Badge>;
};

/**
 * The registration tokens, built like every other list of the app. Tokens are issued in the
 * add-client wizard, which is also where the two defaults a token carries are entered -- a
 * second entry point here would be a token without them, so the list has no add button.
 */
export const TokenList = ({ tokens, isLoading, deleteToken }: TokenListProps) => {
    const [searchQuery, setSearchQuery] = useSearchQueryParam();

    const filteredTokens = useMemo(() => {
        if (!searchQuery) return tokens;
        const q = searchQuery.toLowerCase();
        return tokens.filter(
            (t) =>
                t.token.toLowerCase().includes(q) ||
                (t.displayName ?? "").toLowerCase().includes(q) ||
                (t.inboundAllowedIp ?? "").toLowerCase().includes(q),
        );
    }, [tokens, searchQuery]);

    const renderActions = (t: Token) => (
        <div onClick={(e) => e.stopPropagation()}>
            <DataAction
                rowId={t.token}
                menuEntries={[
                    {
                        label: "Delete",
                        icon: Trash2,
                        onClick: () => deleteToken(t),
                        variant: "danger",
                    },
                ]}
            />
        </div>
    );

    const tableDef: DataTableDef<Token>[] = [
        {
            tableHeader: "Token",
            tableItemRender: (t) => <TokenValue token={t} />,
        },
        {
            tableHeader: "Client",
            tableItemRender: (t) => <ClientDefaults token={t} />,
        },
        {
            tableHeader: "Expires / Used",
            tableCellClassName: "text-sm text-text-muted",
            sortable: true,
            sortValue: (t) => t.usedAt ?? t.expiresAt,
            tableItemRender: (t) => <Validity token={t} />,
        },
        {
            tableHeader: "Status",
            sortable: true,
            sortValue: (t) => (t.usedAt ? 2 : isExpired(t) ? 1 : 0),
            tableItemRender: (t) => <StatusBadge token={t} />,
        },
        {
            tableHeader: "Actions",
            tableHeaderClassName: "text-center",
            tableCellClassName: "content-center",
            tableItemRender: renderActions,
        },
    ];

    const listColumns: DataListColumnDef<Token>[] = [
        {
            fields: [
                {
                    listLabel: null,
                    listItemRender: (t) => (
                        <div className="flex items-center gap-2 py-1">
                            <StatusBadge token={t} />
                            <TokenValue token={t} />
                        </div>
                    ),
                },
                {
                    listLabel: "Client",
                    listItemRender: (t) => <ClientDefaults token={t} />,
                },
                {
                    listLabel: "Validity",
                    listItemRender: (t) => (
                        <span className="text-sm text-text-muted">
                            <Validity token={t} />
                        </span>
                    ),
                },
            ] satisfies DataListDef<Token>[],
            columnClassName: "flex-1 min-w-0",
        },
        {
            fields: [
                {
                    listLabel: null,
                    listItemRender: (t) => (
                        <div className="mt-2 md:mt-0 flex justify-center">{renderActions(t)}</div>
                    ),
                },
            ] satisfies DataListDef<Token>[],
            columnClassName: "md:text-right",
        },
    ];

    return (
        <DataMultiView
            title={
                <>
                    <Key size={18} className="text-text-muted" /> Client Tokens
                </>
            }
            sort={{ defaultValue: [{ colIndex: 2, direction: "asc" }] }}
            viewMode={{ persist: { key: "tokenViewMode", scope: "local" } }}
            data={filteredTokens}
            tableDef={tableDef}
            listColumns={listColumns}
            keyField="token"
            isLoading={isLoading}
            loadingMessage="Loading tokens…"
            searchable
            searchPlaceholder="Search tokens…"
            search={{ value: searchQuery, onChange: setSearchQuery }}
            emptyMessage="No tokens yet."
            pagination={pagination(PAGE_SIZE.page)}
        />
    );
};
