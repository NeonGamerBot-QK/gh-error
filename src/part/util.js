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
  return `https://github.com/${repoOwner
    .trimEnd()
    .replace("\n", "")}/${repoName}/blob/${commitHash}${fileurl
    .replace("file://", "")
    .replace(process.cwd(), "")}#L${line}`;
}

function generateMermaid(report) {
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

  if (report.reportLocation) {
    const url = convertFileUrlToUrl(
      report.reportLocation.file,
      report.reportLocation.line,
      report.reportLocation.column,
    );
    diagram += `
    class Location {
      +file: "${escape(report.reportLocation.file)}"
      +line: "${escape(report.reportLocation.line)}"
      +column: "${escape(report.reportLocation.column)}"
    }
    ErrorReport *-- Location
    click Location href "${url}" "Go to code"
`;
  }

  diagram += "```";
  return diagram;
}
