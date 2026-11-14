import "server-only";
import { ChatAnthropic } from "@langchain/anthropic";
import { tool } from "@langchain/core/tools";
import { createDeepAgent, type CreateDeepAgentParams } from "deepagents";
import { IntakePatchSchema } from "@/lib/contracts/intake";
import { type IntakeSession, INTAKE_QUESTIONS } from "./intake";

export const INTAKE_MODEL = "claude-sonnet-4-6";
export const INTAKE_TIMEOUT_MS = 20_000;
export type IntakeRunner = (input: {
  session: IntakeSession;
  message: string;
  signal: AbortSignal;
}) => Promise<string>;

const instructions = `You are the founder-facing intake (FDE) agent for a Houston / Los Angeles service-location investigation.
Ask these seven groups, one at a time where information is missing: ${INTAKE_QUESTIONS.map((group) => group.question).join("\n")}
Use save_profile to record the founder's answers. It updates only the current stateless draft, not durable storage.
Inspect the returned profile, missingRequiredFields and findings. Never claim the profile is complete unless profile is non-null.
Do not invent business names, objectives, cities, staff, hours, target customers, budgets or must-haves to satisfy required fields.
A founder may explicitly say unknown: use a null value and unknownReason, not zero; do not block the interview on unknown information.
Numeric/boolean/price-tier entries use {value,unit,origin:'founder',evidenceIds:['founder-answer'],unknownReason?}. Money is USD cents; time offsets are integer minutes since midnight, closing after opening in the same modeled day.
Supported categories: coffee, quick_food, salon_barber, fitness. Save any other category verbatim; the tool marks it unsupported.
The tool proposes category defaults for serviceMinutes, travelMinutes, visitsPerMonth, peakHourProfile, wageRateCentsPerHour, cogsFraction, squareFeetPerStation, minimumFrontOfHouseSqFt and patienceMinutes.
These are illustrative assumptions, not calibrated observations or sales forecasts. Clearly call them defaults and invite review.
Founder statements override ANY default. Record service duration under capacity, wage/COGS/travel/patience under derivedDefaults, and visits/peak/station area/minFOH under assumptions.
If only average ticket or price tier is known, ask about the other; record an explicit unknown only when the founder says it is unknown. Ask about startup/monthly operating budgets too; unknown is acceptable.
Do not change origins to public or costar, research external sources, access files, delegate, or call other services. Missing information becomes findings and follow-up questions.`;

export function createDeepIntakeRunner(
  model: NonNullable<CreateDeepAgentParams["model"]>,
): IntakeRunner {
  return async ({ session, message, signal }) => {
    let saves = 0;
    const saveProfile = tool(
      (patch) => {
        if (++saves > 3) throw new Error("Intake tool call limit exceeded");
        signal.throwIfAborted();
        return JSON.stringify(session.saveProfile(patch));
      },
      {
        name: "save_profile",
        description:
          "Validate and merge founder answers into this interview draft. Returns canonical BusinessProfile or null, missing fields, default provenance, findings, and the next question. Does not write durable storage.",
        schema: IntakePatchSchema,
      },
    );
    const agent = createDeepAgent({
      model,
      tools: [saveProfile],
      systemPrompt: instructions,
      // Override default tool-bearing middleware. No file or delegation capabilities
      // are needed for intake, and no checkpointer/store is configured.
      middleware: [
        { name: "FilesystemMiddleware", tools: [] },
        { name: "subAgentMiddleware", tools: [] },
      ],
      name: "founder_intake",
    });
    const result = await agent.invoke(
      {
        messages: [
          {
            role: "user",
            content: `Current validated draft:\n${JSON.stringify(session.snapshot())}\n\nFounder says:\n${message}`,
          },
        ],
      },
      { recursionLimit: 6, signal },
    );
    const last = [...result.messages]
      .reverse()
      .find((entry) => entry.type === "ai" && entry.content);
    if (!last)
      return (
        session.snapshot().nextQuestion?.question ??
        "Your answers have been recorded in this draft. Review the findings and defaults."
      );
    if (typeof last.content === "string") return last.content;
    return last.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("\n");
  };
}

/** Uses only the already selected Anthropic provider; never chooses a paid fallback. */
export const runConfiguredIntakeAgent: IntakeRunner = async (input) => {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new Error("Intake model is not configured");
  const model = new ChatAnthropic({
    model: INTAKE_MODEL,
    apiKey,
    temperature: 0,
    maxTokens: 1500,
    maxRetries: 0,
    clientOptions: { timeout: 10_000, maxRetries: 0 },
  });
  return createDeepIntakeRunner(model)(input);
};
