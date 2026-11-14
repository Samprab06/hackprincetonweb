import { AIMessage } from "@langchain/core/messages";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { describe, expect, it, vi } from "vitest";
import { createIntakeSession } from "./intake";
import { createDeepIntakeRunner } from "./runner";

vi.mock("server-only", () => ({}));

class ScriptedModel extends BaseChatModel {
  boundNames: string[] = [];
  constructor(private readonly responses: AIMessage[]) {
    super({});
  }
  _llmType() {
    return "intake-test-model";
  }
  bindTools(tools: Parameters<NonNullable<BaseChatModel["bindTools"]>>[0]) {
    this.boundNames = tools.map((entry) =>
      "name" in entry ? String(entry.name) : "",
    );
    return this;
  }
  async _generate() {
    const message = this.responses.shift();
    if (!message) throw new Error("Unexpected extra model invocation");
    return {
      generations: [
        {
          text: typeof message.content === "string" ? message.content : "",
          message,
        },
      ],
    };
  }
}

// Exercises the real compiled deepagents graph, not a mocked createDeepAgent.
describe("deepagents intake binding", () => {
  it("executes a model tool call against the validated session without a provider", async () => {
    const model = new ScriptedModel([
      new AIMessage({
        content: "",
        tool_calls: [
          {
            id: "save-1",
            name: "save_profile",
            args: { category: "coffee", concept: "Coffee for commuters" },
          },
        ],
      }),
      new AIMessage("What is your business name and goal?"),
    ]);
    const session = createIntakeSession("project-1");
    const runner = createDeepIntakeRunner(model);
    const reply = await runner({
      session,
      message: "A coffee shop for commuters",
      signal: new AbortController().signal,
    });
    expect(session.snapshot().draft.concept).toBe("Coffee for commuters");
    expect(session.snapshot().draft.capacity?.serviceMinutes?.origin).toBe(
      "default",
    );
    expect(session.snapshot().profile).toBeNull();
    expect(reply).toContain("business name");
    expect(model.boundNames).toEqual(["save_profile"]);
  });
});
