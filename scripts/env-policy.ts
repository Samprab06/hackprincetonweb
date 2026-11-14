import { pathToFileURL } from "node:url";

export const serverEnvNames = [
  "DATABASE_URL",
  "ANTHROPIC_API_KEY",
  "JEV_API_KEY",
  "CENSUS_API_KEY",
  "OPENAI_API_KEY",
] as const;

export function isSensitiveName(name: string) {
  return /(?:^|_)(?:KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL)(?:_|$)/i.test(name);
}

export function isMain(url: string) {
  return !!process.argv[1] && pathToFileURL(process.argv[1]).href === url;
}
