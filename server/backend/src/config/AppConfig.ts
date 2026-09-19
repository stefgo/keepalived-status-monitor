import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as client from "openid-client";
import YAML from "yaml";
import { logger } from "@kasm/shared/node";
import {
    AppConfigSchema,
    AppSettingsSchema,
    firstIssue,
    type AppConfigParsed,
} from "@kasm/shared";

import crypto from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.resolve(__dirname, "../../../config.yaml");

/**
 * The shape of config.yaml, derived from the schema in `shared` rather than declared a second
 * time. The top level and `settings` stay loose (see AppConfigSchema): unknown keys are an
 * operator's own additions, and saveConfig() writes this object back into the file.
 */
export type AppConfig = AppConfigParsed;

/** Setting keys that were renamed or dropped; removed from the file on startup. */
const OBSOLETE_SETTINGS_KEYS: string[] = [];

let configDoc: YAML.Document = new YAML.Document({});
let config: Record<string, unknown> = {};
let newDefaultsAdded = false;

/**
 * Reads config.yaml as it stands, without filling anything in: defaults belong to
 * AppConfigSchema, and that cannot run yet -- jwtSecret is generated below on first start,
 * and validating before that would reject every fresh installation.
 */
function loadConfig() {
    if (fs.existsSync(CONFIG_PATH)) {
        try {
            const fileContent = fs.readFileSync(CONFIG_PATH, "utf-8");
            configDoc = YAML.parseDocument(fileContent);
            const loaded = configDoc.toJS();
            config = loaded && typeof loaded === "object" ? loaded : {};
        } catch (e) {
            logger.error({ err: e }, "Failed to load config.yaml");
        }
    }

    const settings = config.settings;
    if (settings && typeof settings === "object") {
        const present = settings as Record<string, unknown>;
        // Written back only when a default was missing, as before: a rewrite for no reason
        // would requote values and reflow the operator's file.
        const defaults = AppSettingsSchema.parse({});
        newDefaultsAdded = Object.keys(defaults).some((key) => !(key in present));
        for (const key of OBSOLETE_SETTINGS_KEYS) {
            if (key in present) {
                delete present[key];
                configDoc.deleteIn(["settings", key]);
            }
        }
    } else {
        newDefaultsAdded = true;
    }
}

/**
 * Synchronizes the YAML document with the current config object
 * while preserving structure and comments.
 */
function syncDoc() {
    if (!configDoc.contents) {
        configDoc.contents = configDoc.createNode({});
    }

    const updateRecursive = (path: string[], value: any) => {
        if (
            value !== null &&
            typeof value === "object" &&
            !Array.isArray(value)
        ) {
            for (const [key, val] of Object.entries(value)) {
                updateRecursive([...path, key], val);
            }
        } else {
            configDoc.setIn(path, value);
        }
    };

    // Explicitly handle root-level scalar values like jwtSecret
    for (const [key, value] of Object.entries(config)) {
        if (value !== undefined) {
            updateRecursive([key], value);
        }
    }
}

loadConfig();

export function saveConfig() {
    try {
        syncDoc();
        const yamlOutput = configDoc.toString();
        fs.writeFileSync(CONFIG_PATH, yamlOutput);
    } catch (e) {
        logger.error(
            { err: e, path: CONFIG_PATH },
            "Failed to save config.yaml",
        );
        throw e;
    }
}

if (!config.jwtSecret) {
    logger.info("No JWT secret found in config.yaml, generating a new one...");
    config.jwtSecret = crypto.randomBytes(64).toString("hex");
    try {
        saveConfig();
        logger.info("Generated new JWT secret and saved to config.yaml");
    } catch (e) {
        logger.error(
            { err: e },
            "Failed to save generated JWT secret to config.yaml",
        );
    }
}

/**
 * Checks config.yaml and fills in every default, once, at startup.
 *
 * Runs after the secret above exists and before anything reads a value. A configuration
 * error is a startup failure, not something to discover when a scheduler first reads a
 * value hours later -- and not something to paper over with a default, because a server
 * quietly running on defaults the operator did not choose is worse than one that refuses
 * to start and says which field is wrong.
 */
function validateConfig(): AppConfig {
    const parsed = AppConfigSchema.safeParse(config);
    if (!parsed.success) {
        logger.fatal(
            { path: CONFIG_PATH },
            `Invalid config.yaml -- ${firstIssue(parsed.error)}`,
        );
        process.exit(1);
    }
    config = parsed.data;

    if (newDefaultsAdded && fs.existsSync(CONFIG_PATH)) {
        try {
            saveConfig();
        } catch {
            // Already logged by saveConfig(). A read-only file is no reason to refuse
            // service: the values are valid, they just cannot be written back.
        }
    }
    return parsed.data;
}

export const appConfig: AppConfig = validateConfig();

// Applied only now: pino throws on an unknown level, and the schema has checked it.
if (!process.env.LOG_LEVEL && appConfig.logLevel) {
    logger.level = appConfig.logLevel;
}

export function updateConfig(updates: Partial<AppConfig>) {
    Object.assign(appConfig, updates);
    config = appConfig;
    saveConfig();
}

/**
 * The OIDC block, if it is switched on. The schema has checked the fields at startup, but
 * TypeScript cannot follow that from `enabled` to the fields, so callers get them narrowed.
 */
export function getEnabledOidcSettings(): {
    issuer: string;
    client_id: string;
    client_secret: string;
    redirect_uri: string;
} | null {
    const oidc = appConfig.oidc;
    if (!oidc?.enabled) return null;
    return {
        issuer: oidc.issuer as string,
        client_id: oidc.client_id as string,
        client_secret: oidc.client_secret as string,
        redirect_uri: oidc.redirect_uri as string,
    };
}

let oidcConfig: client.Configuration | null = null;

export async function initOIDC() {
    const oidc = getEnabledOidcSettings();
    if (oidc) {
        try {
            oidcConfig = await client.discovery(
                new URL(oidc.issuer),
                oidc.client_id,
                oidc.client_secret,
            );
            logger.info("OIDC Client initialized");
        } catch (e) {
            logger.error({ err: e }, "Failed to initialize OIDC client");
        }
    }
}

export function getOidcConfig() {
    return oidcConfig;
}
