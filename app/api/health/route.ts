import { probeDatabase } from "@/lib/db/client";
import { evaluateHealth } from "@/lib/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

export async function GET() {
  const result = await evaluateHealth(
    Boolean(process.env.DATABASE_URL?.trim()),
    probeDatabase,
  );
  return Response.json(result.body, {
    status: result.status,
    headers: { "Cache-Control": "no-store" },
  });
}
