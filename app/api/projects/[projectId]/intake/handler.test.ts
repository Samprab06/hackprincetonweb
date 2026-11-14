import { describe, expect, it, vi } from "vitest";
import { createIntakeHandler } from "./handler";

vi.mock("server-only", () => ({}));
import { founderAnswers } from "@/lib/agent/__fixtures__/founder";
import { BusinessProfileSchema } from "@/lib/contracts";
import { INTAKE_TIMEOUT_MS } from "@/lib/agent/runner";

const context = (projectId = "project-1") => ({
  params: Promise.resolve({ projectId }),
});
const request = (body: unknown) =>
  new Request("http://localhost/api/projects/project-1/intake", {
    method: "POST",
    body: JSON.stringify(body),
  });

describe("POST project intake", () => {
  it("returns a schema-valid full profile through a scripted conversation runner", async () => {
    const handler = createIntakeHandler({
      projectExists: async () => true,
      runAgent: async ({ session }) => {
        for (const answer of founderAnswers) session.saveProfile(answer);
        return "Please review the default assumptions.";
      },
    });
    const response = await handler(
      request({ message: "My seven interview answers" }),
      context("authoritative-project"),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(BusinessProfileSchema.parse(body.profile).projectId).toBe(
      "authoritative-project",
    );
    expect(body.missingRequiredFields).toEqual([]);
  });

  it("reports safe validation fields in the established error shape", async () => {
    const handler = createIntakeHandler({ projectExists: async () => true });
    const response = await handler(
      request({ patch: { city: "private invalid input" } }),
      context(),
    );
    const body = await response.json();
    expect(body.code).toBe("INVALID_INTAKE");
    expect(body.field_errors["patch.city"]).toEqual(["Invalid intake value"]);
    expect(JSON.stringify(body)).not.toContain("private invalid input");
  });

  it("does not invoke a runner for an already-aborted request", async () => {
    const controller = new AbortController();
    controller.abort();
    const runAgent = vi.fn(async () => new Promise<string>(() => {}));
    const handler = createIntakeHandler({
      projectExists: async () => true,
      runAgent,
    });
    const req = new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ message: "Coffee" }),
      signal: controller.signal,
    });
    expect((await handler(req, context())).status).toBe(503);
    expect(runAgent).not.toHaveBeenCalled();
  });

  it("bounds a runner that does not respond to cancellation", async () => {
    vi.useFakeTimers();
    try {
      const runAgent = vi.fn(async () => new Promise<string>(() => {}));
      const handler = createIntakeHandler({
        projectExists: async () => true,
        runAgent,
      });
      const response = handler(request({ message: "Coffee" }), context());
      // Let request parsing and project lookup finish before advancing the deadline.
      await vi.waitFor(() => expect(runAgent).toHaveBeenCalled());
      await vi.advanceTimersByTimeAsync(INTAKE_TIMEOUT_MS);
      expect((await response).status).toBe(503);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns a partial stateless interview and lets the caller round trip it", async () => {
    const handler = createIntakeHandler({ projectExists: async () => true });
    const response = await handler(
      request({ patch: { businessName: "Morning Cup", category: "coffee" } }),
      context(),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await response.json();
    expect(body.profile).toBeNull();
    expect(body.persisted).toBe(false);
    const followup = await handler(
      request({
        state: { draft: body.draft, assumptions: body.assumptions },
        patch: { city: "Los Angeles" },
      }),
      context(),
    );
    expect((await followup.json()).draft.city).toBe("Los Angeles");
  });

  it("binds injected conversation runners to the path project", async () => {
    const handler = createIntakeHandler({
      projectExists: async (id) => id === "from-path",
      runAgent: async ({ session }) => {
        session.saveProfile({ concept: "Coffee" });
        return "Which city?";
      },
    });
    const response = await handler(
      request({ message: "Coffee please" }),
      context("from-path"),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.draft.concept).toBe("Coffee");
    expect(body.assistantMessage).toBe("Which city?");
    expect(body.persisted).toBe(false);
  });

  it.each([
    { projectId: "body-project" },
    { patch: { projectId: "body-project" } },
    { patch: { city: "Boston" } },
    { patch: { economics: { extra: 3 } } },
    { message: "" },
    [],
  ])("rejects malformed and identity-changing requests: %j", async (body) => {
    const projectExists = vi.fn(async () => true);
    const handler = createIntakeHandler({ projectExists });
    const response = await handler(request(body), context());
    expect(response.status).toBe(422);
    expect(projectExists).not.toHaveBeenCalled();
  });

  it("returns 422 for malformed JSON and oversized bodies", async () => {
    const handler = createIntakeHandler({ projectExists: async () => true });
    for (const body of [
      "{broken",
      JSON.stringify({ message: "x".repeat(70_000) }),
    ]) {
      const response = await handler(
        new Request("http://localhost", { method: "POST", body }),
        context(),
      );
      expect(response.status).toBe(422);
    }
  });

  it("returns 404 for unknown projects", async () => {
    const handler = createIntakeHandler({ projectExists: async () => false });
    expect((await handler(request({}), context())).status).toBe(404);
  });

  it("sanitizes database and provider failures", async () => {
    const secret = "PRIVATE_PROVIDER_KEY";
    for (const dependencies of [
      {
        projectExists: async () => {
          throw new Error(secret);
        },
      },
      {
        projectExists: async () => true,
        runAgent: async () => {
          throw new Error(secret);
        },
      },
    ]) {
      const handler = createIntakeHandler(dependencies);
      const response = await handler(request({ message: "Coffee" }), context());
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain(secret);
    }
  });

  it("returns 503 when no conversation model is configured", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    try {
      const handler = createIntakeHandler({ projectExists: async () => true });
      expect(
        (await handler(request({ message: "Coffee" }), context())).status,
      ).toBe(503);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
