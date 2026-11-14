import { z } from "zod";
import {
  SiteInventorySchema,
  SiteSearchRequestSchema,
} from "@/lib/contracts/sites";
import { searchSites } from "@/lib/data/sites";

const MAX_BODY_BYTES = 64 * 1024;
type Dependencies = { loadInventory: () => Promise<unknown> };
const json = (body: unknown, status: number) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function readBody(request: Request): Promise<unknown> {
  if (!request.body) throw new Error("Missing body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new Error("Request too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

export function createSitesHandler({ loadInventory }: Dependencies) {
  return async function POST(request: Request) {
    let input: z.input<typeof SiteSearchRequestSchema>;
    try {
      const raw = await readBody(request);
      SiteSearchRequestSchema.parse(raw);
      // Preserve omission vs an explicit NNN estimate for provenance. The pure
      // function parses/defaults this validated original request itself.
      input = raw as z.input<typeof SiteSearchRequestSchema>;
    } catch (error) {
      const field_errors: Record<string, string[]> = {};
      if (error instanceof z.ZodError) {
        for (const issue of error.issues)
          field_errors[issue.path.join(".") || "_request"] = [
            "Invalid search value",
          ];
      } else field_errors._request = ["Invalid search request"];
      return json(
        {
          code: "INVALID_SITE_SEARCH",
          message: "Provide a valid profile and site filters.",
          field_errors,
        },
        422,
      );
    }
    try {
      const inventory = SiteInventorySchema.parse(await loadInventory());
      return json(searchSites(input, inventory), 200);
    } catch {
      return json(
        {
          code: "SITE_SEARCH_UNAVAILABLE",
          message:
            "Site inventory is temporarily unavailable. Please try again.",
          field_errors: {},
        },
        503,
      );
    }
  };
}
