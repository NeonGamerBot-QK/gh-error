import "dotenv/config";
// octokit what the fuck
import { Octokit } from "octokit";
import util from "util";
import crypto from "crypto"
import fs from "fs";
import { execSync } from "node:child_process";
const gh = new Octokit({
    auth: process.env.GH_PAT,
});
// Fields that should NOT affect the hash
const VOLATILE_FIELDS = new Set([
    "timestamp",
    "uptime",
    "memoryUsage",
    "cwd",
    "process",
]);

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

export function stableHashIgnoringVolatile(obj) {
    const cleaned = removeVolatile(obj);
    const json = stableJson(cleaned);
    return crypto.createHash("sha256").update(json).digest("hex");
}

const commitHash = execSync("git rev-parse HEAD").toString().trim();
const repoName = execSync(
    "basename -s .git `git config --get remote.origin.url`",
)
    .toString()
    .trim();
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
    return `https://github.com/${repoOwner
        .trimEnd()
        .replace("\n", "")}/${repoName}/blob/${commitHash}${fileurl
            .replace("file://", "")
            .replace(process.cwd(), "")}#L${line}`;
}

function generateMermaid(report) {
    const escape = (s) => {
        if (s === null || s === undefined) return "N/A";
        return String(s).replace(/"/g, "'").replace(/[\r\n]+/g, ' ').slice(0, 60);
    };

    let diagram = `
\`\`\`mermaid
classDiagram
    class ErrorReport {
      +message: "${escape(report.message)}"
      +name: "${escape(report.name)}"
      +timestamp: "${escape(report.timestamp)}"
      +type: "${escape(report.type)}"
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
        diagram += `
    class Location {
      +file: "${escape(report.reportLocation.file)}"
      +line: "${escape(report.reportLocation.line)}"
    }
    ErrorReport *-- Location
`;
    }

    diagram += "```";
    return diagram;
}

async function handleError(e, promis) {
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

    console.log(errorReport);
    // console.dir(
    //   locationExtraction
    //     ? convertFileUrlToUrl(
    //       locationExtraction.file,
    //       locationExtraction.line,
    //       locationExtraction.column,
    //     )
    //     : "pensive meow",
    // );
    const currentIssues = await gh.rest.issues
        .listForRepo({
            filter: "created",
            labels: "automated-error",
            repo: repoName,
            owner: repoOwner,
            state: "all",
        })
        .then((d) =>
            d.data.map((x) => {
                const isNotPlanned = !x.locked || x.state_reason !== "not_planned";
                x.isNotPlanned = isNotPlanned;
                return x;
            }),
        );
    // create hash from errorData (not super niche)
    const hash = stableHashIgnoringVolatile(errorReport);
    const issue = currentIssues.find((x) => x.body.includes(hash));
    if (issue) {
        if (issue.isNotPlanned) return;
        if (issue.state == "closed") {
            await gh.rest.issues.update({
                repo: repoName,
                owner: repoOwner,
                state: "open",
                issue_number: issue.number,
            });
        }
        await gh.rest.issues.createComment({
            issue_number: issue.number,
            repo: repoName,
            owner: repoOwner,
            body: `Still an active issue!`,
        });
    } else {
        await gh.rest.issues.create({
            repo: repoName,
            owner: repoOwner,
            labels: ["automated-error", "bug"],
            title: `error: ${errorReport.message}`,
            body: `<!-- hash: ${hash} -->\n<!-- full json or smt: \n ${JSON.stringify(errorReport)} \n -->\n# Error report: ${errorReport.message}\n## Stack: \n\`\`\`\n${errorReport.fullReport || errorReport.stack}\n\`\`\` \n\n${generateMermaid(errorReport)}`
        })
    }
    console.log(currentIssues);
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
