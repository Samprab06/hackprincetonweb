import { z } from "zod";

export const fields = [
  { key: "concept", label: "Business concept" },
  { key: "category", label: "Service category", options: ["Coffee shop", "Quick-service food", "Salon or barber", "Fitness studio"] },
  { key: "city", label: "City", options: ["Houston", "Los Angeles"] },
  { key: "areas", label: "Areas to favor or avoid" },
  { key: "rent", label: "Monthly rent ceiling ($)", numeric: true },
  { key: "buildout", label: "Buildout budget ($)", numeric: true },
  { key: "price", label: "Price tier", options: ["Budget", "Midrange", "Premium"] },
  { key: "customers", label: "Target customers" },
  { key: "hours", label: "Opening hours" },
  { key: "staff", label: "Staff on shift", numeric: true },
  { key: "requirements", label: "Must-haves" },
] as const satisfies ReadonlyArray<{ key: string; label: string; options?: readonly string[]; numeric?: boolean }>;

type Field = (typeof fields)[number];
type Key = Field["key"];
const fieldKey = z.enum([fields[0].key, ...fields.slice(1).map((field) => field.key)]);
const answerSchema = z.object({ value: z.string(), origin: z.enum(["default", "founder"]) });

export const intakeSessionSchema = z.object({
  profile: z.partialRecord(fieldKey, answerSchema),
  messages: z.array(z.object({ role: z.enum(["founder", "agent"]), text: z.string() })),
});

export type IntakeSession = z.infer<typeof intakeSessionSchema>;
export type Profile = IntakeSession["profile"];

export function profileValidationMessage(field: Field, value: string): string | undefined {
  const text = value.trim();
  if ("options" in field && !field.options.some((option) => option === text)) {
    return `Choose ${field.options.join(", ")}.`;
  }
  if ("numeric" in field) {
    const number = Number(text);
    if (!/^\d+$/.test(text) || !Number.isSafeInteger(number) || number < (field.key === "staff" ? 1 : 0)) {
      return field.key === "staff" ? "Enter a positive whole number." : "Enter a nonnegative whole number.";
    }
  }
  if (!text) return "Enter an answer.";
}

export const initialSession: IntakeSession = {
  profile: { category: { value: "Coffee shop", origin: "default" }, city: { value: "Houston", origin: "default" } },
  messages: [{ role: "agent", text: "What kind of business are you opening? Describe the concept in a sentence or two." }],
};

export function missingFields(profile: Profile) {
  return fields.filter((field) => profileValidationMessage(field, profile[field.key]?.value ?? "") !== undefined);
}

export function updateProfile(profile: Profile, key: Key, value: string): Profile {
  return { ...profile, [key]: { value, origin: "founder" } };
}

export function answerPrompt(session: IntakeSession, text: string): IntakeSession {
  const field = missingFields(session.profile)[0];
  const answer = text.trim();
  if (!answer) return session;

  let profile = session.profile;
  let reply = "Your profile has all the required fields. You can still edit it in the form.";

  if (field) {
    const value = "options" in field
      ? field.options.find((option) => option.toLowerCase() === answer.toLowerCase())
      : answer;
    const error = profileValidationMessage(field, value ?? answer);
    if (!error) {
      profile = updateProfile(profile, field.key, value ?? answer);
      const next = missingFields(profile)[0];
      reply = next
        ? `I saved ${field.label.toLowerCase()}. Next, enter ${next.label.toLowerCase()}.`
        : "Your profile has all the required fields. Review your answers in the form.";
    } else {
      reply = error;
    }
  }

  return { profile, messages: [...session.messages, { role: "founder", text: answer }, { role: "agent", text: reply }] };
}
