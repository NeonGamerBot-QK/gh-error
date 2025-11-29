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
