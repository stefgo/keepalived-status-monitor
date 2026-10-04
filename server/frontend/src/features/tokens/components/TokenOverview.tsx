import { Token } from "@kasm/shared";
import { TokenList } from "./TokenList";
import { useConfirm } from "@stefgo/react-ui-components";
import { describeDeleteToken } from "../confirmations";
import { useDeleteToken, useTokens } from "../../../queries/tokens";

const NO_TOKENS: Token[] = [];

export const TokenOverview = () => {
    /**
     * Only the first load shows as loading: the list used to say "No tokens yet." until the
     * answer arrived. A reload after a delete keeps the rows on screen instead of flashing.
     */
    const { data: tokens = NO_TOKENS, isLoading } = useTokens();
    const deleteToken = useDeleteToken();
    const { confirm } = useConfirm();

    // Asks first, like every other delete. A refused delete keeps the dialog open, with the
    // server's reason in it -- it used to fail without a word.
    const requestDeleteToken = (token: Token) => {
        const active = !token.usedAt && new Date(token.expiresAt) >= new Date();
        confirm({
            ...describeDeleteToken(active),
            onConfirm: () => deleteToken.mutateAsync(token.tokenHash),
        });
    };

    return (
        <div className="space-y-6">
            <TokenList tokens={tokens} isLoading={isLoading} deleteToken={requestDeleteToken} />
        </div>
    );
};
