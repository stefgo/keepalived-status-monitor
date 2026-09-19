import { appConfig } from "../config/AppConfig.js";
import { TokenRepository } from "../repositories/TokenRepository.js";
import { logger } from "@kasm/shared/node";

export interface TokenCleanupResult {
    removed: number;
}

function readConfig() {
    const ttlDays = parseInt(
        appConfig.settings.retention_invalid_tokens_days ?? "30",
        10,
    );
    const minKeepCount = parseInt(
        appConfig.settings.retention_invalid_tokens_count ?? "10",
        10,
    );
    return {
        ttlDays: Number.isFinite(ttlDays) ? ttlDays : 30,
        minKeepCount: Number.isFinite(minKeepCount) ? minKeepCount : 10,
    };
}

export class TokenCleanupService {
    /**
     * Removes invalid (used or expired) registration tokens older than the
     * configured retention window, while always keeping at least the
     * configured minimum count of the most-recent invalid tokens.
     */
    static run(): TokenCleanupResult {
        const { ttlDays, minKeepCount } = readConfig();
        const removed = TokenRepository.cleanupInvalidTokens(ttlDays, minKeepCount);
        logger.info(
            { removed, ttlDays, minKeepCount },
            "Invalid token cleanup completed",
        );
        return { removed };
    }
}
