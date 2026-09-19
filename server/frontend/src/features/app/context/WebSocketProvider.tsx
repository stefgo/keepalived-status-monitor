import { useEffect, useRef, useState, ReactNode } from "react";
import { useAuth } from "../../auth/AuthContext";
import { WebSocketContext } from "./WebSocketContext";
import { useClientStore } from "../../../stores/useClientStore";
import { useKeepalivedStore } from "../../../stores/useKeepalivedStore";
import { useActivityStore } from "../../../stores/useActivityStore";

interface WebSocketProviderProps {
    children: ReactNode;
}

export const WebSocketProvider = ({ children }: WebSocketProviderProps) => {
    const { isAuthenticated, user } = useAuth();
    const { setClients } = useClientStore();
    const { setState: setKeepalivedState } = useKeepalivedStore();
    const { setEvents, setCurrentUserId, fetchEvents } = useActivityStore();
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
                try {
                    const data = JSON.parse(event.data);

                    if (data.type === "CLIENTS_UPDATE") {
                        setClients(data.payload);
                    }

                    if (data.type === "KEEPALIVED_STATE_UPDATE") {
                        setKeepalivedState(data.payload);
                    }

                    if (data.type === "ACTIVITY_UPDATE") {
                        setEvents(data.payload);
                    }
                } catch (e) {
                    console.error("Failed to parse WS message", e);
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
    }, [isAuthenticated, setClients, setKeepalivedState, setEvents, fetchEvents]);

    // Who has seen which event is kept per user id, which comes from /api/v1/me instead of
    // being decoded out of the JWT.
    useEffect(() => {
        if (user) setCurrentUserId(user.id);
    }, [user, setCurrentUserId]);

    return (
        <WebSocketContext.Provider value={{ isConnected }}>
            {children}
        </WebSocketContext.Provider>
    );
};
