import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { publicEnvIssues, scanClientBundle } from "./check-client-bundle";

test("rejects a server-only env name in emitted client code", () => {
  const directory = mkdtempSync(join(tmpdir(), "client-env-"));
  const bundle = join(directory, "chunk.js");
  try {
    writeFileSync(bundle, "console.log('safe')");
    expect(scanClientBundle(directory)).toEqual([]);
    writeFileSync(bundle, "console.log(env.DATABASE_URL)");
    expect(scanClientBundle(directory)).toEqual([`${bundle}: found server-only name DATABASE_URL`]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("flags public credential names, credential values and reused server values", () => {
  expect(publicEnvIssues({
    DATABASE_URL: "internal",
    NEXT_PUBLIC_DB: "internal",
    NEXT_PUBLIC_TOKEN: "example",
    NEXT_PUBLIC_SETTINGS: "ghp_1234567890123456789012345",
    NEXT_PUBLIC_ORIGIN: "https://example.com",
  })).toEqual([
    "NEXT_PUBLIC_DB appears to contain a credential",
    "NEXT_PUBLIC_TOKEN appears to contain a credential",
    "NEXT_PUBLIC_SETTINGS appears to contain a credential",
  ]);
});
