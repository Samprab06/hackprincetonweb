import { z } from "zod";

export const previewProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  city: z.string(),
  business: z.string(),
  sites: z.array(z.object({
    id: z.string(),
    address: z.string(),
    neighborhood: z.string(),
    squareFeet: z.number().int().positive(),
  })),
});

export type PreviewProject = z.infer<typeof previewProjectSchema>;
