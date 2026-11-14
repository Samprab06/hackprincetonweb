import { readFile } from "node:fs/promises";
import { SQL } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { costarProperties } from "../db/costar-schema";
import {
  publicBlockGroups,
  publicJobs,
  publicPlaces,
} from "../db/public-schema";

describe("catchment geography index alignment", () => {
  it("indexes the geography expressions used by ST_DWithin, not only geometry", async () => {
    const ddl = await readFile(
      new URL("../../scripts/catchment-indexes.sql", import.meta.url),
      "utf8",
    );
    for (const table of [
      costarProperties,
      publicBlockGroups,
      publicJobs,
      publicPlaces,
    ]) {
      const definition = getTableConfig(table).indexes.find((index) =>
        index.config.name?.endsWith("_geog_idx"),
      );
      expect(definition?.config.method).toBe("gist");
      const column = definition!.config.columns[0];
      expect(column).toBeInstanceOf(SQL);
      expect(new PgDialect().sqlToQuery(column as SQL).sql).toContain(
        "::geography",
      );
      expect(ddl).toContain(definition!.config.name);
    }
  });
});
