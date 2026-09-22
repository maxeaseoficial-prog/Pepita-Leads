import postgres from "postgres";

let client: ReturnType<typeof postgres> | null = null;

export function getDatabaseUrl() {
  return process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;
}

export function getSql() {
  const url = getDatabaseUrl();
  if (!url) throw new Error("DATABASE_URL_NOT_CONFIGURED");

  if (!client) {
    client = postgres(url, {
      prepare: false,
      max: 1,
      idle_timeout: 20,
      connect_timeout: 10,
      ssl: "require"
    });
  }

  return {
    query(query: string, params: readonly unknown[] = []) {
      return client!.unsafe(query, params as never[]);
    }
  };
}
