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
    /**
     * Serve the agent's own web server over TLS. Absent means plain HTTP, which is what
     * every installation had before this existed.
     *
     * This is the other half of `allowSelfSignedCertificates`: that one is about the
     * certificate this agent checks when it dials the server, this one about the
     * certificate it presents when the server dials it.
     */
    tls?: AgentTlsConfig;
}

/**
 * Where the certificate and its private key are, for an agent that terminates TLS.
 * Held exactly as the operator wrote them -- see `readTlsMaterial`.
 */
export interface AgentTlsConfig {
    cert: string;
    key: string;
}

/**
 * config.yaml as it comes off the parser: everything optional, because the file is written
 * by hand. The fields a resolver or a schema validates below stay `unknown` -- naming a type
 * for them here would claim a check that happens further down.
 */
type LoadedConfig = {
    clientId?: unknown;
    authToken?: string;
    registrationSecret?: string;
    serverUrl?: string;
    logLevel?: string;
    keepalived?: unknown;
    enableStatusPage?: boolean;
    enableRegisterPage?: boolean;
    allowedNetworks?: unknown;
    listenPort?: unknown;
    tls?: unknown;
    allowSelfSignedCertificates?: unknown;
};

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

/**
 * The TLS block, or undefined when the agent serves plain HTTP.
 *
 * Every fault here is fatal rather than a warning, which is the opposite of how the
 * optional settings around it are read. An agent configured for TLS that fell back to
 * HTTP would serve `/ws/register` -- the route that hands it its auth token -- in the
 * clear, and would look exactly like a working agent while doing it. Refusing to start
 * names the wrong field while somebody is still watching the log.
 *
 * The files are read here rather than at listen(): a path that is wrong is wrong at
 * startup, not when the server first dials hours later. What is returned is what the
 * operator wrote, not the resolved path -- see `readTlsMaterial`.
 */
function resolveTls(fromFile: unknown): AgentTlsConfig | undefined {
    if (fromFile === undefined || fromFile === null) return undefined;

    const fail = (reason: string): never => {
        logger.fatal({ path: CONFIG_PATH }, `Invalid tls in config.yaml -- ${reason}`);
        process.exit(1);
    };

    if (typeof fromFile !== "object" || Array.isArray(fromFile)) {
        return fail("expected a block with cert and key");
    }

    const { cert, key } = fromFile as { cert?: unknown; key?: unknown };
    if (typeof cert !== "string" || cert.trim() === "") {
        return fail("cert must be the path to a certificate file");
    }
    if (typeof key !== "string" || key.trim() === "") {
        return fail("key must be the path to a private key file");
    }

    const tls: AgentTlsConfig = { cert: cert.trim(), key: key.trim() };
    for (const field of ["cert", "key"] as const) {
        const file = path.resolve(ROOT_DIR, tls[field]);
        try {
            fs.readFileSync(file);
        } catch (err) {
            const code = (err as NodeJS.ErrnoException).code;
            return fail(`${field} cannot be read at ${file}${code ? ` (${code})` : ""}`);
        }
    }
    return tls;
}

/**
 * The certificate and key as Fastify wants them, or undefined for a plain HTTP agent.
 *
 * Read on demand instead of being kept in `config`: what is stored there is what the
 * operator wrote, so a relative path stays the relative path they chose. Config.ts has
 * already established that both files can be read, so a throw here means they changed
 * underneath a running agent.
 */
export function readTlsMaterial(): { cert: Buffer; key: Buffer } | undefined {
    if (!config.tls) return undefined;
    return {
        cert: fs.readFileSync(path.resolve(ROOT_DIR, config.tls.cert)),
        key: fs.readFileSync(path.resolve(ROOT_DIR, config.tls.key)),
    };
}

/**
 * Reads the `keepalived` block, with KASM_NOTIFY_FIFO and KASM_NOTIFY_TOKEN laid over it. The
 * environment wins, as with KASM_CLIENT_PORT: a container can switch a trigger on without a
 * mounted config file. An empty variable counts as unset.
 *
 * Fatal when wrong, like allowedNetworks: an agent reading the wrong file reports
 * "keepalived unreadable" forever, which looks like a keepalived fault.
 */
function resolveKeepalivedConfig(fromFile: unknown): AgentKeepalivedConfig {
    const raw: Record<string, unknown> =
        fromFile && typeof fromFile === "object" ? { ...(fromFile as Record<string, unknown>) } : {};
    const fifo = process.env.KASM_NOTIFY_FIFO?.trim();
    if (fifo) raw.notifyFifo = fifo;
    const token = process.env.KASM_NOTIFY_TOKEN?.trim();
    if (token) raw.notifyToken = token;

    const keepalived = AgentKeepalivedConfigSchema.safeParse(raw);
    if (!keepalived.success) {
        logger.fatal(
            { path: CONFIG_PATH },
            `Invalid keepalived settings -- keepalived.${firstIssue(keepalived.error)}`,
        );
        process.exit(1);
    }
    return keepalived.data;
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
    } catch {
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
        const loadedConfig = (configDoc.toJS() ?? {}) as LoadedConfig;

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

        config.keepalived = resolveKeepalivedConfig(loadedConfig.keepalived);

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

        config.tls = resolveTls(loadedConfig.tls);

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
    config.keepalived = resolveKeepalivedConfig(undefined);
}

logger.level = config.logLevel;
