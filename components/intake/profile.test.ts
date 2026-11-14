import { expect, it } from "vitest";
import { answerPrompt, initialSession, intakeSessionSchema, missingFields, updateProfile } from "./profile";

it("accepts an unfinished intake session without requiring answers to every field", () => {
  expect(intakeSessionSchema.safeParse(initialSession).success).toBe(true);
  expect(missingFields(initialSession.profile).map((field) => field.key)).toContain("concept");
});

it("uses current form edits when choosing the next field to ask about", () => {
  const profile = updateProfile(initialSession.profile, "concept", "Coffee and pastries");
  const session = answerPrompt({ ...initialSession, profile }, "Montrose");
  expect(session.profile.areas).toEqual({ value: "Montrose", origin: "founder" });
  expect(missingFields(session.profile)[0]?.key).toBe("rent");
});

it("marks an edited default as founder-provided", () => {
  expect(updateProfile(initialSession.profile, "city", "Los Angeles").city)
    .toEqual({ value: "Los Angeles", origin: "founder" });
});
