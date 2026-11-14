import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadKit, readJsonLines, sizeBand } from "./load-costar";

describe("CoStar import stream", () => {
  it("streams JSON objects and ignores blank lines", async () => {
    const dir = await mkdtemp(join(tmpdir(), "costar-test-"));
    try {
      const path = join(dir, "synthetic.jsonl");
      await writeFile(path, '{"id":1}\n\n{"id":2}\r\n');
      const rows = [];
      for await (const row of readJsonLines(path)) rows.push(row);
      expect(rows).toEqual([{ id: 1 }, { id: 2 }]);
    } finally {
      await rm(dir, { recursive: true });
    }
  });
  it("reports malformed input by line, without including licensed content", async () => {
    const dir = await mkdtemp(join(tmpdir(), "costar-test-"));
    try {
      const path = join(dir, "synthetic.jsonl");
      await writeFile(path, '{"id":1}\n["private text"]\n');
      await expect(async () => {
        for await (const row of readJsonLines(path)) void row;
      }).rejects.toThrow(/at line 2$/);
    } finally {
      await rm(dir, { recursive: true });
    }
  });
  it("uses disjoint bands and retains unknown size", () => {
    expect(
      [null, 999, 1000, 2499, 2500, 4999, 5000, 9999, 10000].map(sizeBand),
    ).toEqual([
      "unknown",
      "<1000",
      "1000-2499",
      "1000-2499",
      "2500-4999",
      "2500-4999",
      "5000-9999",
      "5000-9999",
      ">=10000",
    ]);
  });
  it("reports a synthetic kit deterministically without a database", async () => {
    const dir = await mkdtemp(join(tmpdir(), "costar-test-"));
    try {
      await mkdir(join(dir, "schemas"));
      await mkdir(join(dir, "data"));
      await writeFile(
        join(dir, "schemas/enums.json"),
        JSON.stringify({
          PropertyType: { "6": "GeneralRetail" },
          SpaceUse: { "5": "Retail" },
          ListingStatus: { "1": "Active", "3": "OffMarket" },
        }),
      );
      const jsonl = (data: unknown[]) =>
        data.map((r) => JSON.stringify(r)).join("\n");
      await writeFile(
        join(dir, "data/commercial-property.jsonl"),
        jsonl([
          {
            id: 1,
            propertyType: 6,
            primaryAddress: {
              city: "Houston",
              latitude: 29.7,
              longitude: -95.4,
            },
          },
        ]),
      );
      await writeFile(
        join(dir, "data/commercial-listing-summary.jsonl"),
        jsonl([
          {
            id: 2,
            propertyId: 1,
            listingStatus: 1,
            forLeaseSummary: {
              spaces: [
                {
                  id: 3,
                  propertyId: 1,
                  spaceUse: 5,
                  squareFeetMin: 1500,
                  squareFeetMax: 1500,
                },
              ],
            },
          },
          {
            id: 6,
            listingStatus: 1,
            forLeaseSummary: {
              properties: [
                { id: 99, propertyType: 6, address: { city: "Los Angeles" } },
              ],
              spaces: [
                { id: 7, propertyId: 99, spaceUse: 5, squareFeetMax: 800 },
              ],
            },
          },
        ]),
      );
      await writeFile(
        join(dir, "data/location-occupancy.jsonl"),
        jsonl([
          { id: 4, propertyId: 1, toDate: null },
          { id: 5, propertyId: 1, toDate: "2020-01-01" },
        ]),
      );
      const first = await loadKit(dir);
      expect(first).toEqual(await loadKit(dir));
      expect(first.counts).toMatchObject({
        properties: 1,
        spaces: 2,
        tenancies: 1,
        spacesOutsidePropertyDataset: 1,
      });
      expect(first.report).toEqual({
        "Houston | active | retail-use | 1000-2499": 1,
        "Houston | active | retail-building | 1000-2499": 1,
        "Los Angeles | active | retail-use | <1000": 1,
        "Los Angeles | active | retail-building | <1000": 1,
      });
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});
