import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isSensitiveName, isMain } from "./env-policy";

export function envFileIssues(paths: string[], example: string): string[] {
  const issues = paths
    .filter((path) => path !== ".env.example" && path.split("/").at(-1)?.startsWith(".env"))
    .map((path) => `Unexpected tracked environment file: ${path}`);
  for (const [index, line] of example.split(/\r?\n/).entries()) {
    const assignment = /^\s*(?:export\s+)?([A-Za-z_][\w]*)\s*=\s*(.*)$/.exec(line);
    if (!assignment) continue;
    const [, name, value] = assignment;
    const trimmed = value.trim();
    if (isSensitiveName(name) && !/^(?:(?:""|'')\s*)?(?:#.*)?$/.test(trimmed)) {
      issues.push(`.env.example:${index + 1}: ${name} must be empty`);
    }
  }
  return issues;
}

if (isMain(import.meta.url)) {
  const paths = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0");
  const issues = envFileIssues(paths, readFileSync(".env.example", "utf8"));
  for (const issue of issues) console.error(issue);
  if (issues.length) process.exitCode = 1;
}
