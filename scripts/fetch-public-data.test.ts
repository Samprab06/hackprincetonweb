import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  censusUrl,
  csvRows,
  METROS,
  placeCategoryFilter,
  requireSourceCoverage,
} from "./fetch-public-data";

describe("public preparation inputs", () => {
  it("includes alternate taxonomy labels in extraction, not only primary/hierarchy", () => {
    expect(placeCategoryFilter()).toContain("list_has_any(taxonomy.alternates");
    expect(placeCategoryFilter()).toContain("'yoga_studio'");
  });
  it("rejects an empty metro even when another metro already loaded rows", () => {
    expect(() => requireSourceCoverage(100, 100, "second metro")).toThrow(
      /second metro/,
    );
    expect(() => requireSourceCoverage(100, 101, "second metro")).not.toThrow();
  });
  it("requests 50 ACS fields without putting credentials in provenance", () => {
    const url = censusUrl("06037");
    expect(url.searchParams.get("get")?.split(",")).toHaveLength(50);
    expect(url.searchParams.get("in")).toBe("state:06 county:037 tract:*");
    expect(url.searchParams.has("key")).toBe(false);
    expect(() => censusUrl("48';DROP")).toThrow(/FIPS/);
  });
  it("includes the current ten-county Houston and two-county LA metros", () => {
    expect(METROS[0].counties).toHaveLength(10);
    expect(METROS[0].counties).toContain("48407");
    expect(METROS[1].counties).toEqual(["06037", "06059"]);
  });
  it("streams compressed CSV, retaining quoted names and GEOID leading zeros", async () => {
    const dir = await mkdtemp(join(tmpdir(), "public-csv-"));
    try {
      const path = join(dir, "synthetic.csv.gz");
      await writeFile(
        path,
        gzipSync(
          'tabblk2020,cty,name\n060370001001001,06037,"Synthetic, County"\n',
        ),
      );
      const rows = [];
      for await (const row of csvRows(path)) rows.push(row);
      expect(rows).toEqual([
        {
          tabblk2020: "060370001001001",
          cty: "06037",
          name: "Synthetic, County",
        },
      ]);
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});
