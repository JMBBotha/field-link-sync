import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  {
    files: ["src/components/**/*.{ts,tsx}", "src/pages/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.object.object.name='supabase'][callee.object.property.name='auth'][callee.property.name='getSession']",
          message:
            "Use useAuth() from @/contexts/AuthContext instead of direct supabase.auth calls.",
        },
        {
          selector:
            "CallExpression[callee.object.object.name='supabase'][callee.object.property.name='auth'][callee.property.name='onAuthStateChange']",
          message:
            "Use useAuth() from @/contexts/AuthContext instead of direct supabase.auth calls.",
        },
      ],
    },
  },
);
