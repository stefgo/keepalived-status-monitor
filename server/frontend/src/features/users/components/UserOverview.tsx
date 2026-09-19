import { useState, useEffect } from "react";
import { apiFetch } from "../../../lib/apiFetch";
import { UserDialog } from "./UserDialog";
import { UserList, UserData } from "./UserList";
import { useConfirm } from "@stefgo/react-ui-components";
import { describeDeleteUser, describeLastUser } from "../confirmations";

export const UserOverview = () => {
    const [users, setUsers] = useState<UserData[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [editingUser, setEditingUser] = useState<UserData | null>(null);
    const { confirm, alert } = useConfirm();
    /** Bumped to load the list again after a change; the effect below is the only loader. */
    const [reloadCount, setReloadCount] = useState(0);

    // The effect only ever lowers isLoading: the first load starts with it set, and a
    // reload raises it in fetchUsers, outside the effect. A response that arrives after
    // the next reload has started is dropped, so an older list cannot overwrite a newer one.
    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const res = await apiFetch("/api/v1/users");
                if (res.ok) {
                    const list = await res.json();
                    if (!cancelled) setUsers(list);
                }
            } catch (e) {
                console.error(e);
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        };
        load();
        return () => {
            cancelled = true;
        };
    }, [reloadCount]);

    const fetchUsers = () => {
        setIsLoading(true);
        setReloadCount((n) => n + 1);
    };

    const handleCreateUser = () => {
        setEditingUser(null);
        setIsDialogOpen(true);
    };

    const handleEditUser = (user: UserData) => {
        setEditingUser(user);
        setIsDialogOpen(true);
    };

    /**
     * The list already disables the entry for the last user, so this branch is the second
     * net -- it catches a list that has gone stale, which is exactly when the click gets
     * through. The server refuses the same case in UserController.delete; asking here
     * means the operator reads why instead of an error after the fact.
     */
    const requestDeleteUser = (user: UserData) => {
        // A notice rather than a mode of the delete dialog: the two say different things,
        // and this one must not be able to reach the request at all.
        if (users.length <= 1) {
            alert(describeLastUser(user.username));
            return;
        }
        // A refused delete keeps the dialog open, with the server's reason in it.
        confirm({
            ...describeDeleteUser(user.username),
            onConfirm: async () => {
                const res = await apiFetch(`/api/v1/users/${user.id}`, { method: "DELETE" });
                if (!res.ok) {
                    const data = await res.json().catch(() => ({}));
                    throw new Error(data.error || "Failed to delete user");
                }
                fetchUsers();
            },
        });
    };

    const handleSaveUser = async (data: {
        username: string;
        password?: string;
        auth_methods?: string;
    }) => {
        const url = editingUser
            ? `/api/v1/users/${editingUser.id}`
            : "/api/v1/users";
        const method = editingUser ? "PUT" : "POST";

        const res = await apiFetch(url, {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
        });

        if (!res.ok) {
            const errorData = await res.json();
            throw new Error(errorData.error || "Failed to save user");
        }

        fetchUsers();
    };

    return (
        <div className="space-y-6">
            <UserList
                users={users}
                isLoading={isLoading}
                onCreateUser={handleCreateUser}
                onEditUser={handleEditUser}
                onDeleteUser={requestDeleteUser}
            />

            <UserDialog
                isOpen={isDialogOpen}
                onClose={() => setIsDialogOpen(false)}
                onSave={handleSaveUser}
                editingUser={editingUser}
            />
        </div>
    );
};
