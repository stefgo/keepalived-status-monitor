import { useMemo } from "react";
import { Plus, Trash2, Edit2, User, Key, Globe } from "lucide-react";
import {
    Badge,
    Button,
    DataAction,
    DataListColumnDef,
    DataListDef,
    DataMultiView,
    DataTableDef,
} from "@stefgo/react-ui-components";
import { formatDate } from "../../../utils";
import { useSearchQueryParam } from "../../../hooks/useSearchQueryParam";
import { PAGE_SIZE, pagination } from "../../../components/listDefaults";

export interface UserData {
    id: number;
    username: string;
    auth_methods?: string;
    created_at: string;
}

interface UserListProps {
    users: UserData[];
    isLoading: boolean;
    onEditUser: (user: UserData) => void;
    onDeleteUser: (user: UserData) => void;
    onCreateUser: () => void;
}

const AuthBadges = ({ methods: methodsStr }: { methods?: string }) => {
    const methods = methodsStr ? methodsStr.split(",") : ["local"];
    return (
        <div className="flex gap-1">
            {methods.includes("local") && (
                <Badge variant="neutral" size="sm" className="inline-flex items-center gap-1">
                    <Key size={10} /> Local
                </Badge>
            )}
            {methods.includes("oidc") && (
                <Badge variant="info" size="sm" className="inline-flex items-center gap-1">
                    <Globe size={10} /> OIDC
                </Badge>
            )}
        </div>
    );
};

/**
 * The accounts that may sign in. Built like every other list of the app -- search, a list
 * view for narrow screens, the add button in the list's own header -- where it used to be
 * a bare table in a card.
 */
export const UserList = ({
    users,
    isLoading,
    onEditUser,
    onDeleteUser,
    onCreateUser,
}: UserListProps) => {
    const [searchQuery, setSearchQuery] = useSearchQueryParam();

    const filteredUsers = useMemo(() => {
        if (!searchQuery) return users;
        const q = searchQuery.toLowerCase();
        return users.filter((u) => u.username.toLowerCase().includes(q));
    }, [users, searchQuery]);

    // One set of actions for both views, so the table and the list cannot drift apart.
    const renderActions = (user: UserData) => (
        <div onClick={(e) => e.stopPropagation()}>
            <DataAction
                rowId={user.id}
                actions={[
                    {
                        icon: Edit2,
                        onClick: () => onEditUser(user),
                        color: "blue",
                        tooltip: "Edit",
                    },
                ]}
                menuEntries={[
                    {
                        label: "Delete",
                        icon: Trash2,
                        onClick: () => onDeleteUser(user),
                        variant: "danger",
                        disabled: users.length <= 1,
                        disabledTitle: "Cannot delete the last user",
                    },
                ]}
            />
        </div>
    );

    const tableDef: DataTableDef<UserData>[] = [
        {
            tableHeader: "User",
            tableCellClassName: "text-sm font-medium text-text-primary",
            accessorKey: "username",
            sortable: true,
        },
        {
            tableHeader: "Auth",
            tableItemRender: (user) => <AuthBadges methods={user.auth_methods} />,
        },
        {
            tableHeader: "Created",
            tableCellClassName: "text-sm text-text-muted",
            sortable: true,
            sortValue: (user) => user.created_at,
            tableItemRender: (user) => formatDate(user.created_at),
        },
        {
            tableHeader: "Actions",
            tableHeaderClassName: "text-center",
            tableCellClassName: "content-center",
            tableItemRender: renderActions,
        },
    ];

    const listColumns: DataListColumnDef<UserData>[] = [
        {
            fields: [
                {
                    listLabel: null,
                    listItemRender: (user) => (
                        <div className="flex items-center gap-2 py-1">
                            <User size={16} className="text-text-muted" />
                            <span className="font-medium text-text-primary">{user.username}</span>
                        </div>
                    ),
                },
                {
                    listLabel: "Auth",
                    listItemRender: (user) => <AuthBadges methods={user.auth_methods} />,
                },
                {
                    listLabel: "Created",
                    listItemRender: (user) => (
                        <span className="text-sm text-text-muted">{formatDate(user.created_at)}</span>
                    ),
                },
            ] satisfies DataListDef<UserData>[],
            columnClassName: "flex-1",
        },
        {
            fields: [
                {
                    listLabel: null,
                    listItemRender: (user) => (
                        <div className="mt-2 md:mt-0 flex justify-center">{renderActions(user)}</div>
                    ),
                },
            ] satisfies DataListDef<UserData>[],
            columnClassName: "md:text-right",
        },
    ];

    return (
        <DataMultiView
            title={
                <>
                    <User size={18} className="text-text-muted" /> Users
                </>
            }
            extraActions={
                <Button size="sm" icon={Plus} onClick={onCreateUser}>
                    Add User
                </Button>
            }
            sort={{ defaultValue: [{ colIndex: 0, direction: "asc" }] }}
            viewMode={{ persist: { key: "userViewMode", scope: "local" } }}
            data={filteredUsers}
            tableDef={tableDef}
            listColumns={listColumns}
            keyField="id"
            isLoading={isLoading}
            loadingMessage="Loading users…"
            searchable
            searchPlaceholder="Search users…"
            search={{ value: searchQuery, onChange: setSearchQuery }}
            emptyMessage="No users found."
            pagination={pagination(PAGE_SIZE.page)}
        />
    );
};
