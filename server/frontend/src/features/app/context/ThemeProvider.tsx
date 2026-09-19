import { useEffect, useState, ReactNode } from "react";
import { ThemeContext, Theme } from "./ThemeContext";

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
    // Default to dark mode as per original design
    const [theme, setTheme] = useState<Theme>(() => {
        const stored = localStorage.getItem("theme");
        return (stored as Theme) || "dark";
    });

    useEffect(() => {
        const root = window.document.documentElement;
        root.classList.remove("light", "dark");
        root.classList.add(theme);
        localStorage.setItem("theme", theme);
    }, [theme]);

    const toggleTheme = () => {
        setTheme((prev) => (prev === "dark" ? "light" : "dark"));
    };

    return (
        <ThemeContext.Provider value={{ theme, toggleTheme }}>
            {children}
        </ThemeContext.Provider>
    );
};
