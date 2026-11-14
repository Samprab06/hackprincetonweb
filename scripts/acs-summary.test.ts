import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACS_VARIABLES } from "../lib/data/public";
import {
  prepareAcsSummary,
  readSummaryTable,
  summaryColumn,
} from "./acs-summary";
import { fetchPublicData } from "./fetch-public-data";

const directories: string[] = [];
async function temporaryDirectory() {
  const path = await mkdtemp(join(tmpdir(), "acs-summary-"));
  directories.push(path);
  return path;
}
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

function syntheticFile(
  table: string,
  ids = ["1500000US060370001001", "1500000US482010001001"],
) {
  const variables = ACS_VARIABLES.filter((v) =>
    v.startsWith(`${table}_`),
  ).flatMap((v) => [v, v.replace(/E$/, "M")]);
  return (
    [
      ["GEO_ID", ...variables.map(summaryColumn)].join("|"),
      ...ids.map((id) =>
        [
          id,
          ...variables.map((v) =>
            v.endsWith("M") ? "3" : table === "B19013" ? "-666666666" : "10",
          ),
        ].join("|"),
      ),
    ].join("\n") + "\n"
  );
}

describe("keyless ACS Summary Files", () => {
  it("joins four tables by GEOID, preserves MOEs and null sentinels, and reuses downloads", async () => {
    const cache = await temporaryDirectory();
    const fetcher = vi.fn<typeof fetch>(async (url) => {
      const table = /-(b\d+)\.dat$/.exec(String(url))![1].toUpperCase();
      return new Response(syntheticFile(table));
    });
    const result = await prepareAcsSummary(
      cache,
      "2024",
      ["06037", "48201"],
      fetcher,
    );
    expect(fetcher).toHaveBeenCalledTimes(4);
    const row = result.get("06037")![0];
    expect(row.geoid).toBe("060370001001");
    expect(row.population).toBe(10);
    expect(row.medianHouseholdIncome).toBeNull();
    expect(row.data.estimates).toMatchObject({
      B01003_001E: 10,
      B01003_001M: 3,
    });
    expect(row.data.ageBands).toMatchObject({ "0-17": 80 });
    expect(row.data.name).toBeNull();
    expect(row.data.summaryFileSources).toHaveLength(4);
    const offline = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("Network should not be used"));
    expect(
      await prepareAcsSummary(cache, "2024", ["06037", "48201"], offline),
    ).toEqual(result);
    expect(offline).not.toHaveBeenCalled();
    const artifact = JSON.parse(
      await readFile(join(cache, "acs-summary-2024-06037.json"), "utf8"),
    );
    expect(
      artifact.inputs.every((input: { sha256: string }) =>
        /^[a-f0-9]{64}$/.test(input.sha256),
      ),
    ).toBe(true);
  });

  it("rejects inconsistent geography across tables and entirely absent counties", async () => {
    const fetcher = vi.fn<typeof fetch>(async (url) => {
      const table = /-(b\d+)\.dat$/.exec(String(url))![1].toUpperCase();
      return new Response(
        syntheticFile(
          table,
          table === "B11001" ? ["1500000US060370001001"] : undefined,
        ),
      );
    });
    await expect(
      prepareAcsSummary(
        await temporaryDirectory(),
        "2024",
        ["06037", "48201"],
        fetcher,
      ),
    ).rejects.toThrow(/different block-group coverage/);
    const complete = vi.fn<typeof fetch>(
      async (url) =>
        new Response(
          syntheticFile(/-(b\d+)\.dat$/.exec(String(url))![1].toUpperCase()),
        ),
    );
    await expect(
      prepareAcsSummary(
        await temporaryDirectory(),
        "2024",
        ["06037", "48015"],
        complete,
      ),
    ).rejects.toThrow(/48015/);
  });

  it("excludes other summary levels and counties, and rejects duplicate or malformed files", async () => {
    const path = join(await temporaryDirectory(), "table.dat");
    await writeFile(
      path,
      syntheticFile("B01003", [
        "1400000US06037000100",
        "1500000US060370001001",
        "1500000US482010001001",
      ]),
    );
    const variables = ["B01003_001E", "B01003_001M"];
    const counties = new Set(["06037"]);
    expect(
      [...(await readSummaryTable(path, variables, counties))].map(
        ([id]) => id,
      ),
    ).toEqual(["060370001001"]);
    await writeFile(
      path,
      syntheticFile("B01003", [
        "1500000US060370001001",
        "1500000US060370001001",
      ]),
    );
    await expect(readSummaryTable(path, variables, counties)).rejects.toThrow(
      /Duplicate/,
    );
    await writeFile(path, "GEO_ID|wrong\n1500000US060370001001|10\n");
    await expect(readSummaryTable(path, variables, counties)).rejects.toThrow(
      /columns/,
    );
  });

  it("prevents Census-only preparation from replacing all three database tables", async () => {
    await expect(
      fetchPublicData({
        acsSource: "summary",
        censusOnly: true,
        databaseUrl: "postgres://unused",
      }),
    ).rejects.toThrow(/cannot replace/);
    await expect(fetchPublicData({ acsSource: "api" })).rejects.toThrow(
      /CENSUS_API_KEY/,
    );
  });
});
