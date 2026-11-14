import { expect, test } from "vitest";
import { envFileIssues } from "./check-env-files";

test("only the root template may be tracked and sensitive assignments must be empty", () => {
  expect(envFileIssues([".env.example", "src/.env.local"], "DATABASE_URL=\nexport JEV_API_KEY=placeholder\nCENSUS_API_KEY='' # empty")).toEqual([
    "Unexpected tracked environment file: src/.env.local",
    ".env.example:2: JEV_API_KEY must be empty",
  ]);
});
