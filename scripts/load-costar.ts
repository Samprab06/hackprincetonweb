import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { config } from "dotenv";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  normalizeAttachments,
  normalizeProperty,
  normalizeSpaces,
  normalizeTenancy,
  type EnumLookup,
  type RawRecord,
} from "../lib/data/costar";
import {
  costarAttachments,
  costarProperties,
  costarSpaces,
  costarTenancies,
} from "../lib/db/costar-schema";

/** Local import only; never imported by the deployed app or client components. */
export async function* readJsonLines(path: string): AsyncGenerator<RawRecord> {
  const stream = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  let lineNumber = 0;
  try {
    for await (const line of lines) {
      lineNumber++;
      if (!line.trim()) continue;
      try {
        const parsed: unknown = JSON.parse(line);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
          throw new Error("not an object");
        yield parsed as RawRecord;
      } catch {
        throw new Error(`Invalid JSON object in ${path} at line ${lineNumber}`);
      }
    }
  } finally {
    lines.close();
    stream.destroy();
  }
}

export function sizeBand(size: number | null): string {
  if (size === null) return "unknown";
  if (size < 1000) return "<1000";
  if (size < 2500) return "1000-2499";
  if (size < 5000) return "2500-4999";
  if (size < 10000) return "5000-9999";
  return ">=10000";
}

export async function loadKit(kitPath: string, databaseUrl?: string) {
  const enums = JSON.parse(
    await readFile(resolve(kitPath, "schemas/enums.json"), "utf8"),
  ) as EnumLookup;
  const records = (dataset: string) =>
    readJsonLines(resolve(kitPath, `data/${dataset}.jsonl`));
  const properties = new Map<
    string,
    { city: string | null; retail: boolean }
  >();
  const counts = {
    properties: 0,
    spaces: 0,
    tenancies: 0,
    attachments: 0,
    spacesOutsidePropertyDataset: 0,
  };
  const report: Record<string, number> = {};
  const countSpace = (
    space: ReturnType<typeof normalizeSpaces>[number],
    listing: RawRecord,
  ) => {
    let property = properties.get(space.propertyId);
    if (!property) {
      counts.spacesOutsidePropertyDataset++;
      const summary = listing.forLeaseSummary as RawRecord | undefined;
      const embedded = Array.isArray(summary?.properties)
        ? (summary.properties as RawRecord[]).find(
            (p) => String(p.id) === space.propertyId,
          )
        : undefined;
      const address = (embedded?.address ??
        (String(listing.propertyId) === space.propertyId
          ? listing.address
          : null)) as RawRecord | null;
      const type = enums.PropertyType?.[String(embedded?.propertyType)];
      property = {
        city: typeof address?.city === "string" ? address.city : null,
        retail: type === "GeneralRetail" || type === "MixedUse",
      };
    }
    const groups = [
      space.retail ? "retail-use" : null,
      property.retail ? "retail-building" : null,
    ].filter(Boolean);
    for (const group of groups) {
      const key = `${property.city ?? "unknown"} | ${space.active ? "active" : "off-market"} | ${group} | ${sizeBand(space.sizeSqFt)}`;
      report[key] = (report[key] ?? 0) + 1;
    }
  };

  // Validate/report without any database connection; sponsor records are never
  // emitted. Used to assess supply even before hosted credentials are available.
  if (!databaseUrl) {
    for await (const raw of records("commercial-property")) {
      const p = normalizeProperty(raw, enums);
      properties.set(p.id, { city: p.city, retail: p.retail });
      counts.properties++;
      counts.attachments += normalizeAttachments(
        raw,
        "commercial-property",
        enums,
      ).length;
    }
    for await (const raw of records("commercial-listing-summary")) {
      for (const space of normalizeSpaces(raw, enums)) {
        countSpace(space, raw);
        counts.spaces++;
      }
      counts.attachments += normalizeAttachments(
        raw,
        "commercial-listing-summary",
        enums,
      ).length;
    }
    for await (const raw of records("location-occupancy")) {
      if (normalizeTenancy(raw, null, enums)) counts.tenancies++;
    }
    return { mode: "report-only", counts, report };
  }

  const client = postgres(databaseUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
  });
  const db = drizzle(client);
  try {
    await client.unsafe(
      await readFile(new URL("./costar-schema.sql", import.meta.url), "utf8"),
    );
    // Keep only join fields, not the full 40MB company dataset or contact details.
    const companies = new Map<string, RawRecord>();
    for await (const raw of records("company-detail")) {
      companies.set(String(raw.id), {
        id: raw.id,
        name: raw.name,
        profile: raw.profile,
        numEmployees: raw.numEmployees,
      });
    }
    await db.transaction(async (tx) => {
      // Concurrent imports serialize. A failure rolls the whole replacement back.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(481101)`);
      await tx.execute(
        sql`TRUNCATE costar_attachments, costar_tenancies, costar_spaces, costar_properties`,
      );
      const attachmentBatch: (typeof costarAttachments.$inferInsert)[] = [];
      const addAttachments = async (
        raw: RawRecord,
        dataset: "commercial-property" | "commercial-listing-summary",
      ) => {
        for (const a of normalizeAttachments(raw, dataset, enums)) {
          attachmentBatch.push(a);
          counts.attachments++;
          if (attachmentBatch.length >= 250) {
            await tx.insert(costarAttachments).values(attachmentBatch);
            attachmentBatch.length = 0;
          }
        }
      };
      // Properties precede current-tenancy foreign keys. Group lease listings
      // may reference outside-kit buildings: preserve those source IDs without
      // fabricating full property records or pretending coordinates are known.
      const propertyBatch: (typeof costarProperties.$inferInsert)[] = [];
      for await (const raw of records("commercial-property")) {
        const p = normalizeProperty(raw, enums);
        properties.set(p.id, { city: p.city, retail: p.retail });
        propertyBatch.push({
          ...p,
          point:
            p.latitude === null || p.longitude === null
              ? null
              : [p.longitude, p.latitude],
        });
        counts.properties++;
        if (propertyBatch.length >= 250) {
          await tx.insert(costarProperties).values(propertyBatch);
          propertyBatch.length = 0;
        }
      }
      if (propertyBatch.length)
        await tx.insert(costarProperties).values(propertyBatch);
      for await (const raw of records("commercial-property"))
        await addAttachments(raw, "commercial-property");
      const spaceBatch: (typeof costarSpaces.$inferInsert)[] = [];
      for await (const raw of records("commercial-listing-summary")) {
        for (const space of normalizeSpaces(raw, enums)) {
          countSpace(space, raw);
          spaceBatch.push(space);
          counts.spaces++;
          if (spaceBatch.length >= 250) {
            await tx.insert(costarSpaces).values(spaceBatch);
            spaceBatch.length = 0;
          }
        }
        await addAttachments(raw, "commercial-listing-summary");
      }
      if (spaceBatch.length) await tx.insert(costarSpaces).values(spaceBatch);
      if (attachmentBatch.length)
        await tx.insert(costarAttachments).values(attachmentBatch);
      const tenancyBatch: (typeof costarTenancies.$inferInsert)[] = [];
      for await (const raw of records("location-occupancy")) {
        const tenancy = normalizeTenancy(
          raw,
          companies.get(String(raw.tenantLocationId)) ?? null,
          enums,
        );
        if (!tenancy) continue;
        tenancyBatch.push(tenancy);
        counts.tenancies++;
        if (tenancyBatch.length >= 250) {
          await tx.insert(costarTenancies).values(tenancyBatch);
          tenancyBatch.length = 0;
        }
      }
      if (tenancyBatch.length)
        await tx.insert(costarTenancies).values(tenancyBatch);
    });
    return { mode: "loaded", counts, report };
  } finally {
    await client.end();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  config({ path: [".env.local", ".env"], quiet: true });
  const reportOnly = process.argv.includes("--report-only");
  const kitPath =
    process.argv.slice(2).find((a) => !a.startsWith("--")) ??
    "costar-hackathon-kit";
  if (!reportOnly && !process.env.DATABASE_URL) {
    console.error(
      "DATABASE_URL is required to load. Use --report-only for an offline inventory.",
    );
    process.exitCode = 1;
  } else {
    loadKit(kitPath, reportOnly ? undefined : process.env.DATABASE_URL)
      .then((result) => console.log(JSON.stringify(result, null, 2)))
      .catch(() => {
        console.error(
          "CoStar import failed; existing observations were not replaced. Check input files and database configuration.",
        );
        process.exitCode = 1;
      });
  }
}
