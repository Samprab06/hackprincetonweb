import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { config } from "dotenv";
import postgres from "postgres";

export async function createCatchmentIndexes(url: string): Promise<void> {
  const client = postgres(url, { max: 1, prepare: false, connect_timeout: 10 });
  try {
    await client.unsafe(
      await readFile(
        new URL("./catchment-indexes.sql", import.meta.url),
        "utf8",
      ),
    );
  } finally {
    await client.end();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  config({ path: [".env.local", ".env"], quiet: true });
  if (!process.env.DATABASE_URL?.trim()) {
    console.error("An approved DATABASE_URL is required.");
    process.exitCode = 1;
  } else
    createCatchmentIndexes(process.env.DATABASE_URL)
      .then(() => console.log("Catchment geography indexes are ready."))
      .catch(() => {
        console.error(
          "Index setup failed. Confirm source tables and PostGIS are available.",
        );
        process.exitCode = 1;
      });
}
