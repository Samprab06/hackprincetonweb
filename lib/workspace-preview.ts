import { previewProjectSchema } from "./contracts/workspace-preview";

export function getPreviewProject(projectId: string) {
  if (projectId !== "houston-coffee") return null;

  return previewProjectSchema.parse({
    id: projectId,
    name: "Houston coffee shop",
    city: "Houston, TX",
    business: "Coffee shop",
    sites: [
      { id: "montrose", address: "Montrose storefront", neighborhood: "Montrose", squareFeet: 1450 },
      { id: "heights", address: "Heights storefront", neighborhood: "The Heights", squareFeet: 1820 },
    ],
  });
}
