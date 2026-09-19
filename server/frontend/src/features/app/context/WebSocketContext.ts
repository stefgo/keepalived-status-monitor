import { createContext, useContext } from "react";

export interface WebSocketContextType {
    isConnected: boolean;
}

// JSX-free by design -- see AuthContext.ts. The provider lives in WebSocketProvider.tsx.
export const WebSocketContext = createContext<WebSocketContextType | null>(null);

export const useWebSocket = () => {
    return useContext(WebSocketContext);
};
