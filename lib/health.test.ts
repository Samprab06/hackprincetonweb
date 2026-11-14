import { describe, expect, it } from "vitest";
import { evaluateHealth } from "./health";

describe("database readiness", () => {
  it("returns an actionable 503 without probing when configuration is absent", async () => {
    let probes = 0;
    const result = await evaluateHealth(false, async () => {
      probes += 1;
      return { postgis: true };
    });
    expect(probes).toBe(0);
    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({
      code: "DATABASE_NOT_CONFIGURED",
      database: { status: "not_configured" },
      field_errors: {},
    });
  });

  it("reports ready only when the database responds and PostGIS is enabled", async () => {
    const result = await evaluateHealth(true, async () => ({ postgis: true }));
    expect(result).toEqual({
      status: 200,
      body: { status: "ok", database: { status: "connected", postgis: true } },
    });
  });

  it("treats a reachable database without PostGIS as unavailable", async () => {
    const result = await evaluateHealth(true, async () => ({ postgis: false }));
    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({
      code: "POSTGIS_UNAVAILABLE",
      database: { status: "connected", postgis: false },
    });
  });

  it("does not expose credentials or raw provider errors on connection failure", async () => {
    const result = await evaluateHealth(true, async () => {
      throw new Error("password=private postgres://owner:secret@example/db");
    });
    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({
      code: "DATABASE_UNAVAILABLE",
      database: { status: "unavailable" },
    });
    expect(JSON.stringify(result)).not.toMatch(
      /private|secret|example|postgres:\/\//,
    );
  });
});
