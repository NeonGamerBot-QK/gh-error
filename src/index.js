import { execSync } from "node:child_process";
import util from "util";
import crypto from "crypto";
import { Octokit } from "octokit";

// Fields that should NOT affect the hash
const VOLATILE_FIELDS = new Set([
  "timestamp",
  "uptime",
  "memoryUsage",
  "cwd",
  "process",
]);

/**
 * Recursively removes volatile fields from an object.
 * @param {any} value - The value to clean.
 * @returns {any} - The cleaned value.
 */
function removeVolatile(value) {
  if (Array.isArray(value)) {
    return value.map(removeVolatile);
  }
  if (value && typeof value === "object") {
    const cleaned = {};
    for (const key of Object.keys(value)) {
      if (VOLATILE_FIELDS.has(key)) continue;
      cleaned[key] = removeVolatile(value[key]);
    }
    return cleaned;
  }
  return value;
}

/**
 * Converts a value to a stable JSON string with sorted keys.
 * @param {any} value - The value to convert.
 * @returns {string} - The stable JSON string.
 */
function stableJson(value) {
  if (Array.isArray(value)) {
    return "[" + value.map(stableJson).join(",") + "]";
  } else if (value && typeof value === "object") {
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((key) => JSON.stringify(key) + ":" + stableJson(value[key]))
        .join(",") +
      "}"
    );
  } else {
    return JSON.stringify(value);
  }
}

/**
 * Generates a stable SHA-256 hash from an object, ignoring volatile fields.
 * @param {object} obj - The object to hash.
 * @returns {string} - The SHA-256 hash hex string.
 */
export function stableHashIgnoringVolatile(obj) {
  const cleaned = removeVolatile(obj);
  const json = stableJson(cleaned);
  return crypto.createHash("sha256").update(json).digest("hex");
}

/**
 * Extracts file location from a stack trace.
 * @param {string|Error} input - Stack trace or error object.
 * @returns {{file: string, line: string, column: string, frameText: string}|null}
 */
export function extractLocation(input) {
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
    /(?:at\s+\(?)(file:\/\/\/[^\s\):]+):(\d+):(\d+)\)?/,
    /(?:at\s+\(?)(\/[^\s\):]+):(\d+):(\d+)\)?/,
    /(?:at\s+\()?([A-Za-z]:\\[^\s\):]+):(\d+):(\d+)\)?/,
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

/**
 * Converts a file URL to a GitHub blob URL.
 * @param {string} fileurl - The file path or URL.
 * @param {string} line - The line number.
 * @param {string} col - The column number.
 * @param {string} repoOwner - Repository owner.
 * @param {string} repoName - Repository name.
 * @param {string} commitHash - Git commit hash.
 * @param {string} cwd - Current working directory.
 * @returns {string} - The GitHub URL.
 */
export function convertFileUrlToUrl(
  fileurl,
  line,
  col,
  repoOwner,
  repoName,
  commitHash,
  cwd,
) {
  return `https://github.com/${repoOwner.trimEnd().replace("\n", "")}/${repoName}/blob/${commitHash}${fileurl
    .replace("file://", "")
    .replace(cwd, "")}#L${line}`;
}

/**
 * Generates a Mermaid class diagram from an error report.
 * @param {object} report - The error report object.
 * @param {string} commitHash - Git commit hash.
 * @param {string} locationUrl - Optional URL for the location link.
 * @returns {string} - The Mermaid diagram markdown.
 */
export function generateMermaid(report, commitHash, locationUrl) {
  const escape = (s) => {
    if (s === null || s === undefined) return "N/A";
    return String(s)
      .replace(/"/g, "'")
      .replace(/[\r\n]+/g, " ")
      .slice(0, 60);
  };

  let diagram = `
\`\`\`mermaid
classDiagram
    class ErrorReport {
      +message: "${escape(report.message)}"
      +name: "${escape(report.name)}"
      +timestamp: "${escape(report.timestamp)}"
      +type: "${escape(report.type)}"
      +commitHash: "${commitHash}"
    }
    class ProcessInfo {
      +uptime: ${report.process?.uptime}
      +cwd: "${escape(report.process?.cwd)}"
    }
    class MemoryUsage {
      +rss: ${report.process?.memoryUsage?.rss}
      +heapTotal: ${report.process?.memoryUsage?.heapTotal}
      +heapUsed: ${report.process?.memoryUsage?.heapUsed}
    }

    ErrorReport *-- ProcessInfo
    ProcessInfo *-- MemoryUsage
`;

  if (report.reportLocation && locationUrl) {
    diagram += `
    class Location {
      +file: "${escape(report.reportLocation.file)}"
      +line: "${escape(report.reportLocation.line)}"
      +column: "${escape(report.reportLocation.column)}"
    }
    ErrorReport *-- Location
    click Location href "${locationUrl}" "Go to code"
`;
  }

  diagram += "```";
  return diagram;
}

export class ErrorHandler {
  /**
   * Creates an ErrorHandler instance.
   * @param {object} config - Configuration object.
   * @param {string} config.ghPat - GitHub personal access token.
   * @param {string} [config.commitHash] - Git commit hash (auto-detected if not provided).
   * @param {string} [config.repoName] - Repository name (auto-detected if not provided).
   * @param {string} [config.repoOwner] - Repository owner (auto-detected if not provided).
   */
  constructor(config) {
    this.config = config;
    this.gh = new Octokit({ auth: config.ghPat });
  }

  /**
   * Handles an error by creating or updating a GitHub issue.
   * @param {Error} e - The error to handle.
   */
  async handleError(e) {
    const commitHash =
      this.config.commitHash ||
      execSync("git rev-parse HEAD").toString().trim();
    const repoName =
      this.config.repoName ||
      execSync("basename -s .git `git config --get remote.origin.url`")
        .toString()
        .trim();
    const repoOwner =
      this.config.repoOwner ||
      execSync(
        "basename -s .git $(dirname $(git config --get remote.origin.url))",
      )
        .toString()
        .trim();
    const cwd = process.cwd();

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
        cwd,
      },
      fullReport,
      reportLocation: locationExtraction,
    };

    const currentIssues = await this.gh.rest.issues
      .listForRepo({
        filter: "created",
        labels: "automated-error",
        repo: repoName,
        owner: repoOwner,
        state: "all",
      })
      .then((d) =>
        d.data.map((x) => {
          const isNotPlanned = x.locked || x.state_reason === "not_planned";
          x.isNotPlanned = isNotPlanned;
          return x;
        }),
      );

    const hash = stableHashIgnoringVolatile(errorReport);
    const issue = currentIssues.find((x) => x.body.includes(hash));

    if (issue) {
      if (issue.isNotPlanned) return;
      if (issue.state == "closed") {
        await this.gh.rest.issues.update({
          repo: repoName,
          owner: repoOwner,
          state: "open",
          issue_number: issue.number,
        });
      }
      await this.gh.rest.issues.createComment({
        issue_number: issue.number,
        repo: repoName,
        owner: repoOwner,
        body: [
          `⚠️ Still an active issue.`,
          ``,
          `Error occurred at: ${new Date().toISOString()}`,
          `Commit: ${commitHash}`,
        ].join("\n"),
      });
    } else {
      const locationUrl = locationExtraction
        ? convertFileUrlToUrl(
            locationExtraction.file,
            locationExtraction.line,
            locationExtraction.column,
            repoOwner,
            repoName,
            commitHash,
            cwd,
          )
        : null;

      await this.gh.rest.issues.create({
        repo: repoName,
        owner: repoOwner,
        labels: ["automated-error", "bug"],
        title: `error: ${errorReport.message}`,
        body: `<!-- hash: ${hash} -->\n<!-- full json or smt: \n ${JSON.stringify(errorReport)} \n -->\n# Error report: ${errorReport.message}\n## Stack: \n\`\`\`\n${errorReport.fullReport || errorReport.stack}\n\`\`\` \n\n${generateMermaid(errorReport, commitHash, locationUrl)}`,
      });
    }
  }

  /**
   * Binds this handler to uncaught exceptions and unhandled rejections.
   */
  bindToErrors() {
    process.on("uncaughtException", (e) => {
      this.handleError(e);
    });
    process.on("unhandledRejection", (e) => {
      this.handleError(e);
    });
  }
}
