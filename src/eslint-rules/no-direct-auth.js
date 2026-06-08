// Custom ESLint rule: enforces that supabase.auth.* methods (getSession, getUser, onAuthStateChange)
// are only called inside src/contexts/AuthContext.tsx. All other code must go through the useAuth() hook.
// This prevents fragmented session state and ensures a single source of truth for authentication.

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow direct supabase.auth calls outside of AuthContext",
    },
    messages: {
      noDirectAuth:
        "Use useAuth() from @/contexts/AuthContext instead of direct supabase.auth calls.",
    },
    schema: [],
  },
  create(context) {
    const filename = context.filename || context.getFilename();
    // Allow the canonical auth context file
    if (filename.includes("src/contexts/AuthContext.tsx")) {
      return {};
    }

    return {
      CallExpression(node) {
        const callee = node.callee;
        if (
          callee.type === "MemberExpression" &&
          callee.object.type === "MemberExpression" &&
          callee.object.object.type === "Identifier" &&
          callee.object.object.name === "supabase" &&
          callee.object.property.type === "Identifier" &&
          callee.object.property.name === "auth" &&
          callee.property.type === "Identifier" &&
          ["getSession", "getUser", "onAuthStateChange"].includes(callee.property.name)
        ) {
          context.report({
            node,
            messageId: "noDirectAuth",
          });
        }
      },
    };
  },
};
