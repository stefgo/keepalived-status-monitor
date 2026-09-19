import crypto from "crypto";
import { logger } from "@kasm/shared/node";
import { DEFAULT_AGENT_PORT } from "@kasm/shared";

/**
 * The PIN that guards `POST /api/register` on the agent's own web server.
 *
 * That endpoint decides which server this agent trusts from then on, and the caller supplies
 * both halves of it — server URL and registration token. It listens on every interface, and
 * whoever points the agent at a server of their choosing receives what it reports about this
 * host and can make it signal keepalived. Before this PIN, anyone who could reach the agent's
 * web port could do that, whether the agent was registered yet or not.
 *
 * So the check is a shared secret that is printed to the agent's log, where only someone who
 * can already read the machine's logs (`docker logs kasm-client`) can see it.
 *
 * Unlike in an agent that can be registered only once, re-registering is a feature here (the
 * status page offers it), so the PIN exists whenever the register page is enabled — not only
 * while the agent has no token. It is rotated after every successful registration, which makes
 * each PIN single use without requiring a restart for the next one.
 *
 * Deliberately never persisted to config.yaml: it is regenerated on every start, and what is
 * never written never has to be cleaned up.
 */

/**
 * No 0/O, no 1/I/L. The PIN is read off a terminal and typed into a browser on another
 * machine, so the characters that are routinely confused there are simply absent.
 */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const GROUP = 4;
const GROUPS = 2;

/** Failed attempts before the PIN is rotated, ending an online brute force. */
const MAX_ATTEMPTS = 5;

let currentPin: string | null = null;
let failedAttempts = 0;
let webUiPort = DEFAULT_AGENT_PORT;

function generate(): string {
    const groups: string[] = [];
    for (let g = 0; g < GROUPS; g++) {
        let group = "";
        for (let i = 0; i < GROUP; i++) {
            // randomInt over the alphabet length, not a byte modulo it: 256 is not a
            // multiple of 31, so the modulo would favour the first characters.
            group += ALPHABET[crypto.randomInt(ALPHABET.length)];
        }
        groups.push(group);
    }
    return groups.join("-");
}

/** Strips the cosmetic hyphen and case, so what the operator types matches what we made. */
function normalize(value: string): string {
    return value.trim().toUpperCase().replace(/-/g, "");
}

/** Writes the PIN and the page it belongs to into the log as one block an operator can spot. */
function logPin(pin: string): void {
    const rule = "─".repeat(46);
    logger.info(rule);
    logger.info(`  Setup PIN:  ${pin}`);
    logger.info(`  Web UI:     http://<this-host>:${webUiPort}/register`);
    logger.info("  The PIN is required to register this agent.");
    logger.info(rule);
}

/** Creates the PIN for this process and logs it. Called once the web server listens. */
export function initSetupPin(port: number): void {
    webUiPort = port;
    rotateSetupPin();
}

/** Replaces the PIN with a new one and logs it. */
export function rotateSetupPin(): void {
    currentPin = generate();
    failedAttempts = 0;
    logPin(currentPin);
}

/**
 * Checks a PIN presented by a caller.
 *
 * After MAX_ATTEMPTS failures the PIN is rotated and the new one logged. That ends an online
 * guessing attack without locking the operator out permanently — they read the new value
 * from the same place they read the first one.
 */
export function verifySetupPin(input: string): boolean {
    if (!currentPin) return false;

    const expected = Buffer.from(normalize(currentPin), "utf8");
    const actual = Buffer.from(normalize(input), "utf8");

    // timingSafeEqual throws on a length mismatch, so the lengths are compared first. That
    // leaks only the length of a fixed-format PIN, which is public anyway.
    const ok =
        expected.length === actual.length &&
        crypto.timingSafeEqual(expected, actual);

    if (ok) {
        failedAttempts = 0;
        return true;
    }

    failedAttempts++;
    if (failedAttempts >= MAX_ATTEMPTS) {
        logger.warn(
            { attempts: failedAttempts },
            "Too many failed setup PIN attempts — rotating the PIN",
        );
        rotateSetupPin();
    }
    return false;
}
