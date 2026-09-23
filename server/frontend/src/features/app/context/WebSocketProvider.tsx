import { useEffect, useRef, useState, ReactNode } from "react";
import { DashboardMessageSchema, WS_EVENTS } from "@kasm/shared";
import { useAuth } from "../../auth/AuthContext";
import { WebSocketContext } from "./WebSocketContext";
import { useClientStore } from "../../../stores/useClientStore";
import { useKeepalivedStore } from "../../../stores/useKeepalivedStore";
import { useActivityStore } from "../../../stores/useActivityStore";
import { useSchedulerStore } from "../../../stores/useSchedulerStore";

interface WebSocketProviderProps {
    children: ReactNode;
}

export const WebSocketProvider = ({ children }: WebSocketProviderProps) => {
    const { isAuthenticated } = useAuth();
    const { setClients } = useClientStore();
    const { setState: setKeepalivedState } = useKeepalivedStore();
    // Only the actions: the whole store would re-render the provider on every activity update.
    const setEvents = useActivityStore((s) => s.setEvents);
    const appendEvents = useActivityStore((s) => s.appendEvents);
    const applySeen = useActivityStore((s) => s.applySeen);
    const fetchEvents = useActivityStore((s) => s.fetchEvents);
    const applySchedulerUpdate = useSchedulerStore((s) => s.applyUpdate);
    const [isConnected, setIsConnected] = useState(false);
    const socketRef = useRef<WebSocket | null>(null);
    const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (!isAuthenticated) return;

        let isClosing = false;
        let connectTimeout: ReturnType<typeof setTimeout> | null = null;

        const connect = () => {
            if (socketRef.current?.readyState === WebSocket.OPEN) return;

            const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
            // No token in the URL: the browser attaches the session cookie to the handshake
            // by itself. As a query parameter the JWT went into every access log on the way.
            const wsUrl = `${protocol}//${window.location.host}/ws/dashboard`;

            console.log("Connecting to WebSocket:", wsUrl);
            const socket = new WebSocket(wsUrl);
            socketRef.current = socket;

            socket.onopen = () => {
                console.log("WebSocket connected");
                setIsConnected(true);
                if (reconnectTimeoutRef.current) {
                    clearTimeout(reconnectTimeoutRef.current);
                    reconnectTimeoutRef.current = null;
                }
                fetchEvents();
            };

            socket.onmessage = (event) => {
                let data: unknown;
                try {
                    data = JSON.parse(event.data);
                } catch (e) {
                    console.error("Failed to parse WS message", e);
                    return;
                }

                // The same guarantee the agent side of the protocol has had all along: a
                // payload that does not match what `shared` says the message carries is
                // dropped here instead of reaching a store, where a missing field would
                // only show up as a broken render somewhere else entirely.
                const message = DashboardMessageSchema.safeParse(data);
                if (!message.success) {
                    console.warn("Discarded WS message", message.error.issues);
                    return;
                }

                switch (message.data.type) {
                    case WS_EVENTS.CLIENTS_UPDATE:
                        setClients(message.data.payload);
                        break;
                    case WS_EVENTS.KEEPALIVED_STATE_UPDATE:
                        setKeepalivedState(message.data.payload);
                        break;
                    case WS_EVENTS.ACTIVITY_UPDATE:
                        setEvents(message.data.payload);
                        break;
                    case WS_EVENTS.ACTIVITY_APPENDED:
                        appendEvents(message.data.payload);
                        break;
                    case WS_EVENTS.ACTIVITY_SEEN:
                        applySeen(message.data.payload.ids);
                        break;
                    case WS_EVENTS.SCHEDULER_STATUS_UPDATE:
                        applySchedulerUpdate(message.data.payload);
                        break;
                }
            };

            socket.onclose = (event) => {
                if (isClosing) return; // Ignore intentional closure

                console.log("WebSocket disconnected", event.code, event.reason);
                setIsConnected(false);
                socketRef.current = null;

                if (event.code === 4001 || event.code === 4003) {
                    console.log("Authentication failed, stopping reconnection attempts");
                    return;
                }

                reconnectTimeoutRef.current = setTimeout(() => {
                    connect();
                }, 3000);
            };

            socket.onerror = (err) => {
                if (isClosing) return; // Ignore errors during intentional closure
                console.error("WebSocket error", err);
                socket.close();
            };
        };

        // Delay initial connection slightly to avoid React Strict Mode noisy double-mount in dev
        connectTimeout = setTimeout(() => {
            if (!isClosing) connect();
        }, 100);

        return () => {
            isClosing = true;
            if (connectTimeout) {
                clearTimeout(connectTimeout);
            }
            if (socketRef.current) {
                socketRef.current.onclose = null;
                socketRef.current.close();
                socketRef.current = null;
            }
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
            }
        };
    }, [isAuthenticated, setClients, setKeepalivedState, setEvents, appendEvents, applySeen, fetchEvents, applySchedulerUpdate]);

    return (
        <WebSocketContext.Provider value={{ isConnected }}>
            {children}
        </WebSocketContext.Provider>
    );
};
