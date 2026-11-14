import { z } from "zod";
import { AssumedValueSchema } from "@/lib/contracts";
import { PeakHourProfileSchema } from "@/lib/contracts/intake";
import coffee from "@/fixtures/categories/coffee.json";
import quickFood from "@/fixtures/categories/quick_food.json";
import salonBarber from "@/fixtures/categories/salon_barber.json";
import fitness from "@/fixtures/categories/fitness.json";

const value = AssumedValueSchema.refine(
  (entry) => entry.origin === "default",
  "Category fixtures must be defaults",
);
export const CategoryDefaultsSchema = z
  .object({
    category: z.enum(["coffee", "quick_food", "salon_barber", "fitness"]),
    label: z.string().min(1),
    sources: z
      .array(
        z
          .object({
            id: z.string().min(1),
            title: z.string().min(1),
            url: z.url(),
            limitations: z.array(z.string().min(1)),
          })
          .strict(),
      )
      .min(1),
    values: z
      .object({
        serviceMinutes: value,
        travelMinutes: value,
        visitsPerMonth: value,
        wageRateCentsPerHour: value,
        cogsFraction: value,
        squareFeetPerStation: value,
        minimumFrontOfHouseSqFt: value,
        patienceMinutes: value,
      })
      .strict(),
    peakHourProfile: PeakHourProfileSchema,
  })
  .strict()
  .superRefine((defaults, context) => {
    const ids = new Set(defaults.sources.map((source) => source.id));
    if (ids.size !== defaults.sources.length)
      context.addIssue({
        code: "custom",
        message: "Source ids must be unique",
      });
    for (const entry of [
      ...Object.values(defaults.values),
      ...Object.values(defaults.peakHourProfile),
    ]) {
      if (
        entry.origin !== "default" ||
        entry.evidenceIds.some((id) => !ids.has(id))
      )
        context.addIssue({
          code: "custom",
          message: "Default evidence must resolve to category sources",
        });
      if (entry.value !== null && entry.value < 0)
        context.addIssue({
          code: "custom",
          message: "Defaults must be nonnegative",
        });
    }
    const cogs = defaults.values.cogsFraction.value;
    if (cogs !== null && cogs > 1)
      context.addIssue({
        code: "custom",
        message: "COGS fraction must not exceed one",
      });
  });
export type CategoryDefaults = z.infer<typeof CategoryDefaultsSchema>;
const defaultsByCategory = {
  coffee,
  quick_food: quickFood,
  salon_barber: salonBarber,
  fitness,
};
export function categoryDefaults(
  category: string | undefined,
): CategoryDefaults | null {
  if (!category || !Object.hasOwn(defaultsByCategory, category)) return null;
  return CategoryDefaultsSchema.parse(
    defaultsByCategory[category as keyof typeof defaultsByCategory],
  );
}
