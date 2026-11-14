import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export type DownloadManifest = {
  url: string;
  retrievedAt: string;
  sha256: string;
};

async function checksum(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export async function readCachedManifest(
  path: string,
  sourceUrl: string,
): Promise<DownloadManifest | null> {
  try {
    const manifest = JSON.parse(
      await readFile(`${path}.source.json`, "utf8"),
    ) as DownloadManifest;
    if (
      manifest.url === sourceUrl &&
      manifest.sha256 === (await checksum(path))
    )
      return manifest;
  } catch {
    /* Missing or corrupt cache. */
  }
  return null;
}

export async function saveManifest(
  path: string,
  sourceUrl: string,
): Promise<DownloadManifest> {
  const manifest = {
    url: sourceUrl,
    retrievedAt: new Date().toISOString(),
    sha256: await checksum(path),
  };
  await writeFile(`${path}.source.json`, JSON.stringify(manifest, null, 2));
  return manifest;
}

/** Authentication is used only for the request; never persist a key-bearing URL. */
export async function downloadCached(
  path: string,
  requestUrl: string,
  sourceUrl: string,
  fetcher: typeof fetch = fetch,
): Promise<DownloadManifest> {
  const safeUrl = new URL(sourceUrl);
  if (
    [...safeUrl.searchParams.keys()].some((k) => /key|token|secret/i.test(k))
  ) {
    throw new Error("Source manifest URL must not contain credentials");
  }
  const cached = await readCachedManifest(path, sourceUrl);
  if (cached) return cached;
  await mkdir(dirname(path), { recursive: true });
  const partial = `${path}.${process.pid}.part`;
  try {
    const response = await fetcher(requestUrl, {
      signal: AbortSignal.timeout(300_000),
    });
    if (!response.ok || !response.body)
      throw new Error(
        `Public source download failed (HTTP ${response.status})`,
      );
    const reader = response.body.getReader();
    async function* chunks() {
      try {
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          yield next.value;
        }
      } finally {
        reader.releaseLock();
      }
    }
    await pipeline(Readable.from(chunks()), createWriteStream(partial));
    await rename(partial, path);
    return await saveManifest(path, sourceUrl);
  } finally {
    await rm(partial, { force: true });
  }
}
