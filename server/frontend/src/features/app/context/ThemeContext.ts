import { createContext, useContext } from "react";

export type Theme = "dark" | "light";

export interface ThemeContextType {
    theme: Theme;
    toggleTheme: () => void;
}

// JSX-free by design -- see AuthContext.ts. The provider lives in ThemeProvider.tsx.
export const ThemeContext = createContext<ThemeContextType | null>(null);

export const useTheme = () => {
    const context = useContext(ThemeContext);
    if (!context) throw new Error("useTheme must be used within a ThemeProvider");
    return context;
};
