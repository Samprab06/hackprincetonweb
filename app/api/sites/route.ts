import { createSitesHandler } from "./handler";
import { loadSiteInventory } from "./inventory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createSitesHandler({ loadInventory: loadSiteInventory });
