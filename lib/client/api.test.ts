import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { fetchJson } from "./api";
import { workspaceHref } from "./workspace-routes";

afterEach(() => vi.unstubAllGlobals());

it("parses a successful response through the supplied schema", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ count: "2" })));
  await expect(fetchJson("/api/sites", z.object({ count: z.coerce.number() }))).resolves.toEqual({ count: 2 });
});

it("rejects invalid payloads and unsuccessful responses", async () => {
  vi.stubGlobal("fetch", vi.fn()
    .mockResolvedValueOnce(Response.json({ count: "invalid" }))
    .mockResolvedValueOnce(new Response(null, { status: 503 })));
  const schema = z.object({ count: z.number() });
  await expect(fetchJson("/api/sites", schema)).rejects.toBeInstanceOf(z.ZodError);
  await expect(fetchJson("/api/sites", schema)).rejects.toThrow("HTTP 503");
});

it("preserves the project and selected site across views", () => {
  expect(workspaceHref("coffee shop", "comparison", "site/2")).toBe("/projects/coffee%20shop/comparison?site=site%2F2");
  expect(workspaceHref("coffee shop", "site", "site/2")).toBe("/projects/coffee%20shop/sites/site%2F2");
});
