import "server-only";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

let client: ReturnType<typeof postgres> | undefined;

function getClient() {
  if (client) return client;
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("Database configuration is required.");
  const protocol = new URL(url).protocol;
  if (protocol !== "postgres:" && protocol !== "postgresql:") {
    throw new Error("Database configuration must use PostgreSQL.");
  }
  client = postgres(url, {
    max: 1,
    prepare: false,
    connect_timeout: 5,
    idle_timeout: 20,
    connection: { application_name: "hackprinceton", statement_timeout: 5000 },
  });
  return client;
}

export function getDb() {
  return drizzle(getClient(), { schema });
}

export async function probeDatabase() {
  const sql = getClient();
  const [row] = await sql<{ postgis: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM pg_extension WHERE extname = 'postgis'
    ) AS postgis
  `;
  return { postgis: row?.postgis === true };
}
