import { useMemo } from "react";
import { Plus, Trash2, Edit2, User, Key, Globe } from "lucide-react";
import {
    Badge,
    Button,
    DataAction,
    DataMultiView,
    EmptyState,
    type DataColumnDef,
    PAGE_SIZE,
    listPagination,
    actionsColumn,
    listGroups,
} from "@stefgo/react-ui-components";
import type { User as UserRow } from "@kasm/shared";
import { formatDate } from "../../../utils";
import { useSearchQueryParam } from "../../../hooks/useSearchQueryParam";
import { STORAGE_KEYS } from "../../../lib/storageKeys";

/** One row of `GET /api/v1/users`, as `UserSchema` parses it. */
export type UserData = UserRow;

interface UserListProps {
    users: UserData[];
    isLoading: boolean;
    onEditUser: (user: UserData) => void;
    onDeleteUser: (user: UserData) => void;
    onCreateUser: () => void;
}

const AuthBadges = ({ methods: methodsStr }: { methods?: string | null }) => {
    const methods = methodsStr ? methodsStr.split(",") : ["local"];
    return (
        <div className="flex gap-1">
            {methods.includes("local") && (
                <Badge variant="neutral" className="inline-flex items-center gap-1">
                    <Key size={12} /> Local
                </Badge>
            )}
            {methods.includes("oidc") && (
                <Badge variant="info" className="inline-flex items-center gap-1">
                    <Globe size={12} /> OIDC
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

    const columns: DataColumnDef<UserData>[] = [
        {
            header: "User",
            sortable: true,
            sortValue: (user) => user.username,
            table: { cellClassName: "text-sm font-medium text-text-primary" },
            list: { label: null },
            render: (user, view) =>
                view === "list" ? (
                    <div className="flex items-center gap-2 py-1">
                        <User size={16} className="text-text-muted" />
                        <span className="font-medium text-text-primary">{user.username}</span>
                    </div>
                ) : (
                    user.username
                ),
        },
        {
            header: "Auth",
            render: (user) => <AuthBadges methods={user.auth_methods} />,
        },
        {
            header: "Created",
            sortable: true,
            sortValue: (user) => user.created_at ?? "",
            render: (user) => <span className="text-sm text-text-muted">{formatDate(user.created_at)}</span>,
        },
        actionsColumn(renderActions),
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
            viewMode={{ persist: { key: STORAGE_KEYS.usersView, scope: "local" } }}
            data={filteredUsers}
            columns={columns}
            listGroups={listGroups()}
            keyField="id"
            isLoading={isLoading}
            loadingMessage="Loading users…"
            searchable
            searchPlaceholder="Search users…"
            search={{ value: searchQuery, onChange: setSearchQuery }}
            noResultsMessage={`No users match “${searchQuery}”.`}
            emptyMessage={
                <EmptyState
                    icon={User}
                    title="No users yet"
                    description="Add a user to let someone sign in."
                />
            }
            pagination={listPagination(PAGE_SIZE.page)}
        />
    );
};
