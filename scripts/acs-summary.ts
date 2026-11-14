import { createReadStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "csv-parse";
import {
  ACS_VARIABLES,
  normalizeAcs,
  type PublicSource,
  type RawRow,
} from "../lib/data/public";
import {
  downloadCached,
  saveManifest,
  type DownloadManifest,
} from "./public-cache";

export const ACS_TABLES = ["B01003", "B11001", "B19013", "B01001"] as const;

/** Bulk files use B01003_E001; the existing adapter uses B01003_001E. */
export function summaryColumn(variable: string): string {
  const match = /^(B\d{5})_(\d{3})([EM])$/.exec(variable);
  if (!match) throw new Error(`Invalid ACS variable: ${variable}`);
  return `${match[1]}_${match[3]}${match[2]}`;
}

const VARIABLES = ACS_VARIABLES.flatMap((variable) => [
  variable,
  variable.replace(/E$/, "M"),
]);

/** Streams national files, retaining only full block groups in the requested counties. */
export async function readSummaryTable(
  path: string,
  variables: readonly string[],
  counties: ReadonlySet<string>,
) {
  const columns = variables.map(summaryColumn);
  const input = createReadStream(path);
  const parser = parse({
    delimiter: "|",
    bom: true,
    columns: (headers: string[]) => {
      if (
        new Set(headers).size !== headers.length ||
        !["GEO_ID", ...columns].every((key) => headers.includes(key))
      )
        throw new Error("ACS Summary File has missing or duplicate columns");
      return headers;
    },
  });
  input.on("error", (error) => parser.destroy(error));
  input.pipe(parser);
  const rows = new Map<string, RawRow>();
  try {
    for await (const value of parser) {
      const row = value as RawRow;
      const match = /^1500000US(\d{12})$/.exec(row.GEO_ID);
      if (!match || !counties.has(match[1].slice(0, 5))) continue;
      const geoid = match[1];
      if (rows.has(geoid))
        throw new Error(`Duplicate ACS block group: ${geoid}`);
      rows.set(
        geoid,
        Object.fromEntries(
          variables.map((variable, i) => [variable, row[columns[i]]]),
        ),
      );
    }
  } finally {
    input.destroy();
    parser.destroy();
  }
  if (!rows.size) throw new Error("ACS Summary File selected no block groups");
  return rows;
}

/** Download once without credentials; preserve each input's checksum and retrieval date. */
export async function prepareAcsSummary(
  cache: string,
  vintage: string,
  counties: readonly string[],
  fetcher: typeof fetch = fetch,
) {
  if (
    !/^\d{4}$/.test(vintage) ||
    !counties.length ||
    counties.some((c) => !/^\d{5}$/.test(c))
  )
    throw new Error("Invalid ACS vintage or county FIPS");
  const base = `https://www2.census.gov/programs-surveys/acs/summary_file/${vintage}/table-based-SF/data/5YRData/`;
  const countySet = new Set(counties);
  const tables: Map<string, RawRow>[] = [];
  const inputs: DownloadManifest[] = [];
  for (const table of ACS_TABLES) {
    const name = `acsdt5y${vintage}-${table.toLowerCase()}.dat`;
    const path = resolve(cache, "summary", name);
    inputs.push(await downloadCached(path, base + name, base + name, fetcher));
    tables.push(
      await readSummaryTable(
        path,
        VARIABLES.filter((v) => v.startsWith(`${table}_`)),
        countySet,
      ),
    );
  }
  const ids = [...tables[0].keys()].sort();
  for (const table of tables) {
    if (table.size !== ids.length || ids.some((id) => !table.has(id)))
      throw new Error(
        "ACS Summary File tables have different block-group coverage",
      );
  }
  const result = new Map<string, ReturnType<typeof normalizeAcs>>();
  for (const county of counties) {
    const selected = ids.filter((id) => id.startsWith(county));
    if (!selected.length)
      throw new Error(`ACS Summary File has no block groups for ${county}`);
    const source: PublicSource = {
      origin: "public",
      dataset: "ACS 5-year detailed tables (Summary File)",
      vintage,
      url: base,
      retrievedAt: inputs
        .map((i) => i.retrievedAt)
        .sort()
        .at(-1)!,
    };
    const table = [
      [...VARIABLES, "state", "county", "tract", "block group"],
      ...selected.map((id) => {
        const values = Object.assign(
          {},
          ...tables.map((t) => t.get(id)),
        ) as RawRow;
        return [
          ...VARIABLES.map((v) => values[v]),
          id.slice(0, 2),
          id.slice(2, 5),
          id.slice(5, 11),
          id.slice(11),
        ];
      }),
    ];
    const rows = normalizeAcs(table, source).map((row) => ({
      ...row,
      data: { ...row.data, summaryFileSources: inputs },
    }));
    // An inspectable county subset, separate from the API cache to prevent provenance mixups.
    const output = resolve(cache, `acs-summary-${vintage}-${county}.json`);
    await writeFile(output, JSON.stringify({ table, source, inputs }));
    await saveManifest(output, `${base}#county=${county}`);
    result.set(county, rows);
  }
  return result;
}
