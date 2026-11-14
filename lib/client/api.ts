import type { z } from "zod";

export async function fetchJson<Schema extends z.ZodType>(
  url: string | URL,
  schema: Schema,
  init?: RequestInit,
): Promise<z.output<Schema>> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`Request failed (HTTP ${response.status})`);
  }
  return schema.parse(await response.json());
}
