import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { downloadCached } from "./public-cache";

describe("public download cache", () => {
  it("reuses verified bytes and never persists a request credential", async () => {
    const dir = await mkdtemp(join(tmpdir(), "public-cache-"));
    try {
      const path = join(dir, "acs.json");
      const fetcher = vi.fn(
        async () => new Response("synthetic"),
      ) as unknown as typeof fetch;
      const first = await downloadCached(
        path,
        "https://example.test/acs?key=secret",
        "https://example.test/acs",
        fetcher,
      );
      expect(
        await downloadCached(
          path,
          "https://example.test/acs?key=secret",
          "https://example.test/acs",
          fetcher,
        ),
      ).toEqual(first);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(await readFile(`${path}.source.json`, "utf8")).not.toContain(
        "secret",
      );
      await writeFile(path, "corrupted");
      await downloadCached(
        path,
        "https://example.test/acs?key=secret",
        "https://example.test/acs",
        fetcher,
      );
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      await rm(dir, { recursive: true });
    }
  });
  it("rejects credential-bearing provenance URLs", async () => {
    await expect(
      downloadCached(
        "unused",
        "https://example.test?key=x",
        "https://example.test?key=x",
      ),
    ).rejects.toThrow(/credentials/);
  });
});
