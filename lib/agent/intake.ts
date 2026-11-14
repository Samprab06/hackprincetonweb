import { BusinessProfileSchema, type BusinessProfile } from "@/lib/contracts";
import {
  IntakeDraftSchema,
  IntakePatchSchema,
  IntakeStateSchema,
  type IntakeDraft,
  type IntakeAssumptions,
  type IntakeState,
} from "@/lib/contracts/intake";
import { categoryDefaults } from "./defaults";

export const INTAKE_QUESTIONS = [
  {
    id: "concept",
    question:
      "What is the business name, concept/category, and your goal for this location?",
    fields: ["businessName", "concept", "category", "objective"],
  },
  {
    id: "location",
    question:
      "Houston or Los Angeles? Which areas do you prefer or want to avoid?",
    fields: ["city", "preferredAreas", "avoidedAreas"],
  },
  {
    id: "budget",
    question:
      "What are your monthly rent ceiling and buildout budget? Do you know your total startup and monthly operating budgets? Say explicitly if unknown.",
    fields: [
      "economics.monthlyRentCeilingCents",
      "economics.buildoutBudgetCents",
      "economics.startupBudgetCents",
      "economics.monthlyOperatingBudgetCents",
    ],
  },
  {
    id: "pricing",
    question:
      "What is your average ticket or price tier (budget, mid, premium)? Mark either unknown if you do not know it.",
    fields: ["economics.averageTicketCents", "economics.priceTier"],
  },
  {
    id: "customers",
    question: "Who are your target customers?",
    fields: ["targetCustomers"],
  },
  {
    id: "operations",
    question:
      "What are your opening/closing hours and number of staff or service stations?",
    fields: [
      "operatingHours.openMinute",
      "operatingHours.closeMinute",
      "capacity.servers",
    ],
  },
  {
    id: "must_haves",
    question:
      "For each, is frontage, a corner, parking, or a ground-floor space a must-have? Unknown is OK.",
    fields: [
      "mustHaves.frontage",
      "mustHaves.corner",
      "mustHaves.parking",
      "mustHaves.groundFloor",
    ],
  },
] as const;

const clone = <T>(value: T): T => structuredClone(value);
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function merge(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): Record<string, unknown> {
  const output = clone(left);
  for (const [key, value] of Object.entries(right)) {
    output[key] =
      isRecord(value) && isRecord(output[key]) && !("origin" in value)
        ? merge(output[key] as Record<string, unknown>, value)
        : clone(value);
  }
  return output;
}
function founderValues(value: unknown, evidenceId: string): unknown {
  if (Array.isArray(value))
    return value.map((entry) => founderValues(entry, evidenceId));
  if (!isRecord(value)) return value;
  if ("value" in value && "origin" in value)
    return { ...value, origin: "founder", evidenceIds: [evidenceId] };
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      founderValues(entry, evidenceId),
    ]),
  );
}
function pathValue(value: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (entry, key) => (isRecord(entry) ? entry[key] : undefined),
      value,
    );
}
function unknownPaths(value: unknown, prefix = ""): string[] {
  if (!isRecord(value)) return value === null ? [prefix] : [];
  if ("value" in value) return value.value === null ? [prefix] : [];
  return Object.entries(value).flatMap(([key, entry]) =>
    unknownPaths(entry, prefix ? `${prefix}.${key}` : key),
  );
}

export function createIntakeSession(projectId: string, initial?: IntakeState) {
  if (!projectId.trim() || projectId.length > 200)
    throw new Error("Invalid project identifier");
  let state: IntakeState = initial
    ? clone(IntakeStateSchema.parse(initial))
    : { draft: {}, assumptions: {} };
  function snapshot() {
    const parsed = BusinessProfileSchema.safeParse({
      ...state.draft,
      id: `${projectId}:intake`,
      projectId,
      synthetic: false,
      version: 1,
    });
    const missingRequiredFields = parsed.success
      ? []
      : [
          ...new Set(
            parsed.error.issues.map(
              (issue) => issue.path.join(".") || "category",
            ),
          ),
        ];
    const nextQuestion =
      INTAKE_QUESTIONS.find((group) =>
        group.fields.some(
          (field) => pathValue(state.draft, field) === undefined,
        ),
      ) ?? null;
    const defaults = categoryDefaults(state.draft.category);
    const findings = [
      ...missingRequiredFields.map(
        (field) => `Missing required field: ${field}`,
      ),
      ...unknownPaths(state.draft).map(
        (field) => `Unknown founder information: ${field}`,
      ),
      ...unknownPaths(state.assumptions).map(
        (field) => `Unknown assumption: ${field}`,
      ),
      ...(state.draft.category === "unsupported"
        ? [
            `Category '${state.draft.unsupportedCategory ?? "unspecified"}' is unsupported; no category defaults or calibrated demand model are available.`,
          ]
        : []),
      ...(defaults
        ? [
            "Category defaults are illustrative scenario assumptions, not empirically calibrated local predictions. Review and override them with founder information.",
          ]
        : []),
    ];
    return clone({
      persisted: false as const,
      ...state,
      profile: parsed.success ? parsed.data : (null as BusinessProfile | null),
      missingRequiredFields,
      findings,
      questions: INTAKE_QUESTIONS,
      nextQuestion,
      defaultSources: defaults?.sources ?? [],
    });
  }
  function saveProfile(input: unknown) {
    const parsed = IntakePatchSchema.parse(input);
    const patch = founderValues(
      parsed,
      `founder:${projectId}`,
    ) as typeof parsed;
    const nextAssumptions = patch.assumptions ?? {};
    delete patch.assumptions;
    if (patch.category !== undefined) {
      const supported = BusinessProfileSchema.shape.category.safeParse(
        patch.category,
      );
      if (!supported.success) {
        patch.unsupportedCategory = patch.category;
        patch.category = "unsupported";
      }
    }
    let draft = merge(state.draft, patch) as IntakeDraft;
    const assumptions = merge(
      state.assumptions,
      nextAssumptions,
    ) as IntakeAssumptions;
    if (patch.category !== undefined) {
      if (draft.category !== "unsupported") delete draft.unsupportedCategory;
      // A category change replaces defaults, while preserving every founder override.
      const defaults = categoryDefaults(draft.category);
      for (const [container, key, defaultKey] of [
        ["capacity", "serviceMinutes", "serviceMinutes"],
        ["derivedDefaults", "travelMinutes", "travelMinutes"],
        ["derivedDefaults", "patienceMinutes", "patienceMinutes"],
        ["derivedDefaults", "wageRateCentsPerHour", "wageRateCentsPerHour"],
        ["derivedDefaults", "cogsFraction", "cogsFraction"],
      ] as const) {
        const values = { ...draft[container] } as Record<string, unknown>;
        if (!isRecord(values[key]) || values[key].origin !== "founder") {
          if (defaults) values[key] = clone(defaults.values[defaultKey]);
          else delete values[key];
        }
        draft = { ...draft, [container]: values };
      }
      for (const key of [
        "visitsPerMonth",
        "squareFeetPerStation",
        "minimumFrontOfHouseSqFt",
      ] as const) {
        if (assumptions[key]?.origin !== "founder") {
          if (defaults) assumptions[key] = clone(defaults.values[key]);
          else delete assumptions[key];
        }
      }
      if (defaults) {
        const existing = assumptions.peakHourProfile;
        assumptions.peakHourProfile = clone(defaults.peakHourProfile);
        if (
          existing &&
          Object.values(existing).every((entry) => entry.origin === "founder")
        )
          assumptions.peakHourProfile = existing;
      } else if (
        !assumptions.peakHourProfile ||
        Object.values(assumptions.peakHourProfile).some(
          (entry) => entry.origin !== "founder",
        )
      )
        delete assumptions.peakHourProfile;
    }
    // Validate merged constraints (e.g. hours across separate turns) before changing state.
    state = clone(
      IntakeStateSchema.parse({
        draft: IntakeDraftSchema.parse(draft),
        assumptions,
      }),
    );
    return snapshot();
  }
  return { snapshot, saveProfile };
}
export type IntakeSession = ReturnType<typeof createIntakeSession>;
export type IntakeResult = ReturnType<IntakeSession["snapshot"]>;
