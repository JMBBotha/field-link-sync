import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function client(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "list_customers",
  title: "List customers",
  description:
    "List or search customers for the signed-in user's company (RLS-scoped). Optional case-insensitive name search.",
  inputSchema: {
    search: z.string().optional().describe("Case-insensitive name/email/phone substring."),
    limit: z.number().int().min(1).max(100).default(25),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ search, limit }, ctx) => {
    if (!ctx.isAuthenticated())
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };

    let q = client(ctx)
      .from("customers")
      .select("id,name,email,phone,address,created_at")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (search) {
      const s = `%${search}%`;
      q = q.or(`name.ilike.${s},email.ilike.${s},phone.ilike.${s}`);
    }

    const { data, error } = await q;
    if (error)
      return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: { customers: data ?? [] },
    };
  },
});
