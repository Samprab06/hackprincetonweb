import { z } from "zod";
import { IntakeRequestSchema } from "@/lib/contracts/intake";
import { createIntakeSession } from "@/lib/agent/intake";
import {
  INTAKE_TIMEOUT_MS,
  runConfiguredIntakeAgent,
  type IntakeRunner,
} from "@/lib/agent/runner";

const MAX_BODY_BYTES = 64 * 1024;
const projectIdSchema = z.string().trim().min(1).max(200);
type Context = { params: Promise<{ projectId: string }> };
type Dependencies = {
  projectExists: (projectId: string) => Promise<boolean>;
  runAgent?: IntakeRunner;
};
const json = (body: unknown, status: number) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const unavailable = () =>
  json(
    {
      code: "INTAKE_UNAVAILABLE",
      message: "Intake is temporarily unavailable. Please try again.",
      field_errors: {},
    },
    503,
  );
function invalid(error: unknown) {
  const field_errors: Record<string, string[]> = {};
  if (error instanceof z.ZodError) {
    for (const issue of error.issues) {
      const field = issue.path.join(".") || "_request";
      field_errors[field] = ["Invalid intake value"];
    }
  } else field_errors._request = ["Invalid intake request"];
  return json(
    {
      code: "INVALID_INTAKE",
      message: "Provide valid intake values for this project.",
      field_errors,
    },
    422,
  );
}

async function readBody(request: Request): Promise<unknown> {
  if (!request.body) throw new Error("Missing body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new Error("Request too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

export function createIntakeHandler(dependencies: Dependencies) {
  return async function POST(request: Request, context: Context) {
    let input: z.infer<typeof IntakeRequestSchema>;
    let projectId: string;
    try {
      projectId = projectIdSchema.parse((await context.params).projectId);
      input = IntakeRequestSchema.parse(await readBody(request));
    } catch (error) {
      return invalid(error);
    }
    try {
      if (!(await dependencies.projectExists(projectId)))
        return json(
          {
            code: "PROJECT_NOT_FOUND",
            message: "Project not found.",
            field_errors: {},
          },
          404,
        );
    } catch {
      return unavailable();
    }
    let session;
    try {
      session = createIntakeSession(projectId, input.state);
      if (input.patch) session.saveProfile(input.patch);
    } catch (error) {
      return invalid(error);
    }
    let assistantMessage =
      session.snapshot().nextQuestion?.question ??
      "Review your profile, assumptions, and findings.";
    if (input.message) {
      const controller = new AbortController();
      const signal = AbortSignal.any([request.signal, controller.signal]);
      let onAbort: (() => void) | undefined;
      const timeout = setTimeout(() => controller.abort(), INTAKE_TIMEOUT_MS);
      try {
        // Register cancellation before starting the runner; an already-aborted
        // signal does not emit another event to a newly added listener.
        signal.throwIfAborted();
        const aborted = new Promise<never>((_, reject) => {
          onAbort = () => reject(new Error("Intake deadline exceeded"));
          signal.addEventListener("abort", onAbort, { once: true });
        });
        assistantMessage = await Promise.race([
          (dependencies.runAgent ?? runConfiguredIntakeAgent)({
            session,
            message: input.message,
            signal,
          }),
          aborted,
        ]);
      } catch {
        return unavailable();
      } finally {
        clearTimeout(timeout);
        if (onAbort) signal.removeEventListener("abort", onAbort);
      }
    }
    return json({ ...session.snapshot(), assistantMessage }, 200);
  };
}
