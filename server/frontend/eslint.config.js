import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
    globalIgnores(["dist"]),
    // Config files at the workspace root (vite, tailwind, postcss and this file).
    {
        files: ["**/*.{js,jsx}"],
        extends: [
            js.configs.recommended,
            reactHooks.configs.flat.recommended,
            reactRefresh.configs.vite,
        ],
        languageOptions: {
            ecmaVersion: 2020,
            globals: {
                ...globals.browser,
                ...globals.node,
            },
            parserOptions: {
                ecmaVersion: "latest",
                ecmaFeatures: { jsx: true },
                sourceType: "module",
            },
        },
        rules: {
            "no-unused-vars": ["error", { varsIgnorePattern: "^[A-Z_]" }],
        },
    },
    // The application itself. Until this block existed the config only matched
    // js/jsx, so none of src/ was ever linted -- react-hooks never saw a single
    // component. Without type information, so no project wiring is needed.
    {
        files: ["**/*.{ts,tsx}"],
        extends: [
            tseslint.configs.recommended,
            reactHooks.configs.flat.recommended,
            reactRefresh.configs.vite,
        ],
        languageOptions: {
            ecmaVersion: 2020,
            globals: globals.browser,
            parserOptions: {
                ecmaVersion: "latest",
                ecmaFeatures: { jsx: true },
                sourceType: "module",
            },
        },
        rules: {
            "@typescript-eslint/no-unused-vars": [
                "error",
                { varsIgnorePattern: "^[A-Z_]", argsIgnorePattern: "^_" },
            ],
        },
    },
]);
