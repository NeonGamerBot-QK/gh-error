import "dotenv/config";
// octokit what the fuck
// import octokit from "octokit"
import util from "util";
import fs from "fs";
import { execSync } from "node:child_process";

const commitHash = execSync("git rev-parse HEAD").toString().trim();
const repoName = execSync(
  "basename -s .git `git config --get remote.origin.url`",
).toString().trim();
const repoOwner = execSync(
  "basename -s .git $(dirname $(git config --get remote.origin.url))",
)
  .toString()
  .trim();
function extractLocation(input) {
  if (!input) return null;

  let stack =
    typeof input === "string"
      ? input
      : input &&
      (input.stack || input.fullReport || input["stack"] || input.toString());

  if (!stack || typeof stack !== "string") return null;

  if (stack.includes("\\n")) {
    stack = stack.replace(/\\n/g, "\n");
  }

  const lines = stack.split("\n").map((l) => l.trim());
  if (lines.length && lines[0].startsWith("Error")) {
    lines.shift();
  }

  const patterns = [
    // file:///...:line:col or (file:///...:line:col)
    /(?:at\s+\(?)(file:\/\/\/[^\s\):]+):(\d+):(\d+)\)?/,
    // absolute unix path: /home/...:line:col
    /(?:at\s+\(?)(\/[^\s\):]+):(\d+):(\d+)\)?/,
    // windows path: C:\...:line:col
    /(?:at\s+\()?([A-Za-z]:\\[^\s\):]+):(\d+):(\d+)\)?/,
    // fallback: something like at foo (index.js:10:5)
    /(?:at\s+.*\()?([^\s\):]+):(\d+):(\d+)\)?/,
  ];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (
      line.includes("node:internal") ||
      line.includes("internal/") ||
      line.includes("<anonymous>")
    )
      continue;

    for (const re of patterns) {
      const m = line.match(re);
      if (m) {
        return {
          file: m[1],
          line: m[2],
          column: m[3],
          frameText: line,
        };
      }
    }
  }

  return null;
}

function convertFileUrlToUrl(fileurl, line, col) {
  return `https://github.com/${repoOwner.trimEnd().replace("\n", "")}/${repoName}/blob/${commitHash}${fileurl
    .replace("file://", "")
    .replace(process.cwd(), "")}#L${line}`;
}

function handleError(e, promis) {
  const fullReport = util.inspect(e, {
    showHidden: true,
    showProxy: true,
    depth: 2,
    colors: false,
    breakLength: 120,
  });

  const locationExtraction = extractLocation(e.stack);

  const errorReport = {
    message: e.message,
    name: e.name,
    stack: e.stack,
    timestamp: new Date().toISOString(),
    code: e.code,
    data: e.data,
    cause: e.cause,
    type: e.constructor?.name,
    process: {
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      cwd: process.cwd(),
    },
    fullReport,
    reportLocation: locationExtraction,
  };

  console.log(
    errorReport
  );
  console.dir(locationExtraction
    ? convertFileUrlToUrl(locationExtraction.file, locationExtraction.line, locationExtraction.column)
    : "pensive meow")
}

// normal bindings
process.on("uncaughtException", (e) => {
  handleError(e);
});
process.on("unhandledRejection", (e, prom) => {
  handleError(e);
});
// extra
process.on("multipleResolves", (type, prom, value) => { });
process.on("rejectionHandled", (promise) => { });

// throw new Error("Ballistic missle inbound!");

setTimeout(() => {
  throw new Error("interballistic missle inbound!");
});
