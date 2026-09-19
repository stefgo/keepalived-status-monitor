import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import YAML from "yaml";
import { logger } from "@kasm/shared/node";
import {
    AgentKeepalivedConfig,
    AgentKeepalivedConfigSchema,
    AgentNetworkConfigSchema,
    DEFAULT_AGENT_PORT,
    firstIssue,
} from "@kasm/shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "../../");

// Paths
/**
 * `config.yaml` next to the agent, unless KASM_CLIENT_CONFIG names another file -- which
 * lets two agents run from one checkout, as the two of compose.dev.yaml do.
 */
export const CONFIG_PATH =
    process.env.KASM_CLIENT_CONFIG?.trim() || path.resolve(ROOT_DIR, "config.yaml");

export interface ClientConfig {
    serverUrl?: string;
    websocketURL?: string;
    /**
     * The id the server issued during registration. Absent until then: the agent never picks
     * one itself, because an id chosen by the caller is what let a registration take over an
     * existing client. Presented together with the token on every connection: the server
     * resolves the pair, and one half without the other cannot connect.
     */
    clientId?: string;
    authToken?: string;
    registrationSecret?: string;
    logLevel: string;
    /** Where and how often keepalived is read -- see AgentKeepalivedConfigSchema. */
    keepalived: AgentKeepalivedConfig;
    enableStatusPage?: boolean;
    enableRegisterPage?: boolean;
    /**
     * The port the local web server listens on -- the status and register pages, and the
     * two routes the server dials an outbound agent on. Configurable because with
     * `network_mode: host` the `ports:` mapping no longer applies, and a port already
     * taken on the host would stop the agent's web UI from starting at all.
     */
    listenPort: number;
    /**
     * Networks the server may dial this agent from, checked on `/ws/register` and
     * `/ws/agent`. Empty means no restriction, as before the setting existed. The local web
     * UI on the same port is deliberately not covered: it is where an operator registers
     * the agent, and a list holding only the server's address would shut them out of it.
     */
    allowedNetworks: string[];
    /**
     * Accept a server certificate that does not validate, for registration and for the
     * WebSocket alike. Off by default: that WebSocket carries the auth token, and a
     * certificate nobody checks is one anybody in between can present.
     */
    allowSelfSignedCertificates: boolean;
}

// Global Document state to preserve comments
let configDoc: YAML.Document = new YAML.Document({});

// Default Config
export const config: ClientConfig = {
    logLevel: process.env.LOG_LEVEL || "info",
    enableStatusPage: true,
    enableRegisterPage: true,
    allowedNetworks: [],
    allowSelfSignedCertificates: false,
    listenPort: DEFAULT_AGENT_PORT,
    keepalived: AgentKeepalivedConfigSchema.parse(undefined),
};

/**
 * Reads a port from config.yaml or KASM_CLIENT_PORT. The environment wins, so a container
 * needs one variable rather than a mounted config file just to move the port.
 *
 * A value that is not a port is refused rather than silently replaced by the default: an
 * agent listening somewhere other than where its operator put it is the harder fault to
 * find. Node reads port 0 as "any free port", which is never what this setting means.
 */
function resolveListenPort(fromFile: unknown): number {
    const raw = process.env.KASM_CLIENT_PORT ?? fromFile;
    if (raw === undefined || raw === null || raw === "") return DEFAULT_AGENT_PORT;

    const port = Number(raw);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        logger.fatal(
            { value: raw },
            "Invalid listen port -- expected an integer between 1 and 65535",
        );
        process.exit(1);
    }
    return port;
}

function writeToDisk(): void {
    try {
        fs.writeFileSync(CONFIG_PATH, configDoc.toString());
    } catch (e) {
        logger.error({ err: e }, "Failed to save config.yaml");
    }
}

function applyServerUrl(url: string): void {
    config.serverUrl = url;
    try {
        const urlObj = new URL(url);
        if (urlObj.protocol === "http:") {
            urlObj.protocol = "ws:";
        } else if (urlObj.protocol === "https:") {
            urlObj.protocol = "wss:";
        }
        if (!urlObj.pathname.endsWith("/ws/agent")) {
            urlObj.pathname = path.join(urlObj.pathname, "ws/agent");
        }
        config.websocketURL = urlObj.toString();
    } catch (e) {
        logger.error("Failed to parse server URL for websocket: " + url);
    }
}

/**
 * Stores the identity the server issued during registration. Both halves are written in one
 * go: every later connection is checked as a pair, so a config holding one without the other
 * could not connect and would have to be registered again anyway.
 */
export function persistIdentity(authToken: string, clientId: string): void {
    config.authToken = authToken;
    configDoc.set("authToken", authToken);
    config.clientId = clientId;
    configDoc.set("clientId", clientId);
    writeToDisk();
}

export function persistServerUrl(url: string): void {
    applyServerUrl(url);
    configDoc.set("serverUrl", config.serverUrl);
    writeToDisk();
}

export function deleteRegistrationSecret(): void {
    delete config.registrationSecret;
    if (configDoc.has("registrationSecret")) {
        // Set to empty plain scalar (renders as "registrationSecret:" with no value)
        // to preserve the key and its comments rather than deleting them.
        const emptyScalar = new YAML.Scalar(null);
        emptyScalar.type = "PLAIN";
        emptyScalar.source = "";
        configDoc.set("registrationSecret", emptyScalar);
    }
    writeToDisk();
}

// Load Config
if (fs.existsSync(CONFIG_PATH)) {
    try {
        const fileContent = fs.readFileSync(CONFIG_PATH, "utf-8");
        configDoc = YAML.parseDocument(fileContent);
        const loadedConfig = configDoc.toJS() as any;

        // No id is generated when the file has none: it is issued by the server on
        // registration (see persistIdentity).
        if (typeof loadedConfig.clientId === "string" && loadedConfig.clientId) {
            config.clientId = loadedConfig.clientId;
        }

        if (loadedConfig.authToken) {
            config.authToken = loadedConfig.authToken;
        }

        if (loadedConfig.registrationSecret) {
            config.registrationSecret = loadedConfig.registrationSecret;
        }

        if (loadedConfig.serverUrl) {
            applyServerUrl(loadedConfig.serverUrl);
            logger.info("Using Server URL from config: " + config.serverUrl);
        }

        if (loadedConfig.logLevel) {
            config.logLevel = loadedConfig.logLevel;
        }

        // Fatal when wrong, like allowedNetworks: an agent reading the wrong file reports
        // "keepalived unreadable" forever, which looks like a keepalived fault.
        const keepalived = AgentKeepalivedConfigSchema.safeParse(
            loadedConfig.keepalived ?? undefined,
        );
        if (!keepalived.success) {
            logger.fatal(
                { path: CONFIG_PATH },
                `Invalid config.yaml -- keepalived.${firstIssue(keepalived.error)}`,
            );
            process.exit(1);
        }
        config.keepalived = keepalived.data;

        if (loadedConfig.enableStatusPage !== undefined) {
            config.enableStatusPage = loadedConfig.enableStatusPage;
        }

        if (loadedConfig.enableRegisterPage !== undefined) {
            config.enableRegisterPage = loadedConfig.enableRegisterPage;
        }

        // Validated strictly and fatal when wrong: a typo here would lock the server out
        // without a word, and the connection one would fix it over is the one refused.
        const networks = AgentNetworkConfigSchema.safeParse({
            allowedNetworks: loadedConfig.allowedNetworks ?? undefined,
        });
        if (!networks.success) {
            logger.fatal(
                { path: CONFIG_PATH },
                `Invalid config.yaml -- ${firstIssue(networks.error)}`,
            );
            process.exit(1);
        }
        config.allowedNetworks = networks.data.allowedNetworks;

        config.listenPort = resolveListenPort(loadedConfig.listenPort);

        if (typeof loadedConfig.allowSelfSignedCertificates === "boolean") {
            config.allowSelfSignedCertificates = loadedConfig.allowSelfSignedCertificates;
        } else if (
            loadedConfig.allowSelfSignedCertificates !== undefined &&
            loadedConfig.allowSelfSignedCertificates !== null
        ) {
            logger.warn(
                "Ignoring allowSelfSignedCertificates in config.yaml: expected true or false",
            );
        }
    } catch (e) {
        logger.error({ err: e }, "Failed to load config.yaml");
    }
} else {
    // If config file doesn't exist, use defaults
    logger.info("No config.yaml found. Using defaults.");
    // KASM_CLIENT_PORT still applies: a fresh container has no config.yaml yet, and moving
    // its port is exactly the case the variable exists for.
    config.listenPort = resolveListenPort(undefined);
}

logger.level = config.logLevel;
