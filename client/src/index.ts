import { Connection } from "./core/Connection.js";
import { startWebServer, stopWebServer, isWebServerNeeded } from "./web/server.js";
import { logger } from "@kasm/shared/node";
import { WS_EVENTS } from "@kasm/shared";
import { ActivityService } from "./services/ActivityService.js";
import { KeepalivedService } from "./services/KeepalivedService.js";
import { NotifyFifoWatcher } from "./services/NotifyFifoWatcher.js";

if (isWebServerNeeded()) {
    // Awaited so the process handlers below are only in place once startup is
    // done. startWebServer() already catches and logs a failed listen(); without
    // the await, a failing plugin registration would end up in the
    // unhandledRejection handler instead of aborting the start.
    await startWebServer();
} else {
    logger.info("Web server disabled: status page, register page and outbound mode are all inactive.");
}

// Before the connection, deliberately: the readings belong to the host, not to the link.
// An agent that comes up while the server is unreachable still notices a failover and
// reports it once there is somewhere to report to.
KeepalivedService.start((status) => {
    Connection.send(WS_EVENTS.KEEPALIVED_UPDATE, status);
});
// Does nothing unless keepalived.notifyFifo is set.
NotifyFifoWatcher.start();

// Try to connect to server
Connection.connect();

// Handle graceful shutdown
const shutdown = async () => {
    logger.info("Received shutdown signal, terminating client...");
    // Before anything else: whatever the server has not acknowledged is only in memory
    // and in a write that may still be pending, and this process is about to end.
    ActivityService.persistNow();
    NotifyFifoWatcher.stop();
    await stopWebServer();
    process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Registered only after startup, so a failed start (web server plugins) still fails fast
// instead of being swallowed here.

// The agent has to survive a stray rejection: it holds the connection the server
// monitors this host through, and nobody is watching it interactively.
process.on("unhandledRejection", (reason) => {
    logger.error({ err: reason }, "Unhandled promise rejection");
});

// An uncaught exception leaves the process in an unknown state. Log it and exit so
// the supervisor restarts us (compose.yaml: restart: unless-stopped).
process.on("uncaughtException", (err) => {
    logger.fatal({ err }, "Uncaught exception, terminating");
    // Give the pino transport worker a moment to flush before we go.
    setTimeout(() => process.exit(1), 250);
});
