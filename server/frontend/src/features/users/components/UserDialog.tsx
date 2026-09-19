import { useState } from "react";
import { getErrorMessage } from "../../../utils";
import { Button, Checkbox, Input, Modal } from "@stefgo/react-ui-components";

interface UserDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (data: {
        username: string;
        password?: string;
        auth_methods?: string;
    }) => Promise<void>;
    editingUser: { id: number; username: string; auth_methods?: string } | null;
}

export const UserDialog = ({
    isOpen,
    onClose,
    onSave,
    editingUser,
}: UserDialogProps) => {
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [authMethods, setAuthMethods] = useState<string[]>(["local"]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Opening the dialog, or pointing it at another user, starts the form over. Compared
    // against the props it was last seeded from while rendering rather than in an effect,
    // so the dialog never shows a frame with the previous user's name in it.
    const [seededFor, setSeededFor] = useState<{
        isOpen: boolean;
        editingUser: UserDialogProps["editingUser"];
    }>({ isOpen: false, editingUser: null });
    if (isOpen !== seededFor.isOpen || editingUser !== seededFor.editingUser) {
        setSeededFor({ isOpen, editingUser });
        if (isOpen) {
            if (editingUser) {
                setUsername(editingUser.username);
                setPassword(""); // Don't show existing hash
                setAuthMethods(
                    editingUser.auth_methods
                        ? editingUser.auth_methods.split(",")
                        : ["local"],
                );
            } else {
                setUsername("");
                setPassword("");
                setAuthMethods(["local"]);
            }
            setError(null);
        }
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!username) {
            setError("Username is required");
            return;
        }

        // Simpler check:
        // New user with local: required.
        // Existing user adding local: required.
        // Existing user keeping local: optional.

        const previouslyHadLocal =
            editingUser && (editingUser.auth_methods || "local").includes("local");
        const nowHasLocal = authMethods.includes("local");

        if (nowHasLocal && !password && !previouslyHadLocal) {
            setError("Password is required when enabling local authentication");
            return;
        }

        setIsLoading(true);
        setError(null);
        try {
            await onSave({
                username,
                password: password || undefined,
                auth_methods: authMethods.join(","),
            });
            onClose();
        } catch (err: unknown) {
            setError(getErrorMessage(err));
        } finally {
            setIsLoading(false);
        }
    };

    const toggleAuthMethod = (method: string) => {
        setAuthMethods((prev) =>
            prev.includes(method)
                ? prev.filter((m) => m !== method)
                : [...prev, method],
        );
    };

    // Modal brings what the hand-built overlay never had: focus trapped inside, Escape,
    // the page behind it held still, and focus handed back to whatever opened it.
    // closeOnOverlayClick is off because this is a form with unsaved input, where a stray
    // click beside it should not discard the work.
    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={editingUser ? "Edit User" : "Add User"}
            size="lg"
            closeOnOverlayClick={false}
        >
            <form onSubmit={handleSubmit} className="space-y-4 p-6">
                {error && (
                    <div className="bg-error-bg text-error p-3 rounded-lg text-sm">
                        {error}
                    </div>
                )}

                <Input
                    label="Username"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    disabled={!!editingUser}
                    placeholder="username"
                />

                <div>
                    <label className="field-label">Authentication Methods</label>
                    <div className="flex gap-4 mt-1">
                        <Checkbox
                            label="Local (Password)"
                            checked={authMethods.includes("local")}
                            onChange={() => toggleAuthMethod("local")}
                        />
                        <Checkbox
                            label="OIDC (SSO)"
                            checked={authMethods.includes("oidc")}
                            onChange={() => toggleAuthMethod("oidc")}
                        />
                    </div>
                </div>

                {authMethods.includes("local") && (
                    <div className="animate-in fade-in slide-in-from-top-1 duration-200">
                        <Input
                            label={
                                editingUser
                                    ? "New Password (leave blank to keep current)"
                                    : "Password"
                            }
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder={editingUser ? "••••••••" : "password"}
                        />
                    </div>
                )}

                <div className="flex justify-end gap-3 pt-2">
                    {/* Both need an explicit type: Button renders a bare <button>, which
                        defaults to submit inside a form -- so Cancel used to close the
                        dialog and save the user on the way out. */}
                    <Button type="button" variant="secondary" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button type="submit" variant="primary" disabled={isLoading} isLoading={isLoading}>
                        {editingUser ? "Save" : "Add User"}
                    </Button>
                </div>
            </form>
        </Modal>
    );
};
