import { useState, useEffect } from "react";
import { Token } from "@kasm/shared";
import { TokenList } from "./TokenList";
import { apiFetch } from "../../../lib/apiFetch";
import { useConfirm } from "@stefgo/react-ui-components";
import { describeDeleteToken } from "../confirmations";

export const TokenOverview = () => {
    const [tokens, setTokens] = useState<Token[]>([]);
    const { confirm } = useConfirm();

    /** Bumped to load the list again after a change; the effect below is the only loader. */
    const [reloadCount, setReloadCount] = useState(0);

    /**
     * Only the first load shows as loading: the list used to say "No tokens yet." until the
     * answer arrived. A reload after a delete keeps the rows on screen instead of flashing.
     */
    const [isLoading, setIsLoading] = useState(true);

    // A response that arrives after the next reload has started is dropped, so an older
    // list cannot overwrite a newer one. The effect only ever lowers isLoading.
    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const res = await apiFetch("/api/v1/tokens");
                if (res.ok) {
                    const list = await res.json();
                    if (!cancelled) setTokens(list);
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

    const fetchTokens = () => setReloadCount((n) => n + 1);

    // Asks first, like every other delete. A refused delete keeps the dialog open, with the
    // server's reason in it -- it used to fail without a word.
    const requestDeleteToken = (token: Token) => {
        const active = !token.usedAt && new Date(token.expiresAt) >= new Date();
        confirm({
            ...describeDeleteToken(active),
            onConfirm: async () => {
                const res = await apiFetch(`/api/v1/tokens/${token.token}`, { method: "DELETE" });
                if (!res.ok) {
                    const data = await res.json().catch(() => ({}));
                    throw new Error(data.error || "Failed to delete token");
                }
                fetchTokens();
            },
        });
    };

    return (
        <div className="space-y-6">
            <TokenList tokens={tokens} isLoading={isLoading} deleteToken={requestDeleteToken} />
        </div>
    );
};
