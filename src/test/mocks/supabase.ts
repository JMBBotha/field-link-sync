import { vi } from "vitest";

// Chainable query builder mock
function createQueryBuilder(data: any = [], error: any = null) {
  const builder: any = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: data[0] ?? null, error }),
    maybeSingle: vi.fn().mockResolvedValue({ data: data[0] ?? null, error }),
    then: (resolve: any) => resolve({ data, error }),
  };
  // Make it thenable for await
  builder[Symbol.for("Symbol.toStringTag")] = "Promise";
  return builder;
}

export const mockUser = {
  id: "agent-001",
  email: "agent@test.com",
  app_metadata: { role: "field_agent" },
};

export const mockSupabase = {
  auth: {
    getUser: vi.fn().mockResolvedValue({ data: { user: mockUser }, error: null }),
    getSession: vi.fn().mockResolvedValue({
      data: { session: { user: mockUser, access_token: "mock-token" } },
      error: null,
    }),
    onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    signInWithPassword: vi.fn().mockResolvedValue({ data: { user: mockUser }, error: null }),
    signUp: vi.fn().mockResolvedValue({ data: { user: mockUser }, error: null }),
  },
  from: vi.fn().mockImplementation(() => createQueryBuilder()),
  functions: {
    invoke: vi.fn().mockResolvedValue({ data: { success: true }, error: null }),
  },
  storage: {
    from: vi.fn().mockReturnValue({
      upload: vi.fn().mockResolvedValue({ data: { path: "test/photo.jpg" }, error: null }),
      remove: vi.fn().mockResolvedValue({ data: null, error: null }),
      getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: "https://example.com/photo.jpg" } }),
    }),
  },
  channel: vi.fn().mockReturnValue({
    on: vi.fn().mockReturnThis(),
    subscribe: vi.fn().mockReturnThis(),
  }),
  removeChannel: vi.fn(),
};

// Apply mock
vi.mock("@/integrations/supabase/client", () => ({
  supabase: mockSupabase,
}));
