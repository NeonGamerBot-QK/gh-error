import "dotenv/config";
// octokit what the fuck
// import octokit from "octokit"
import util from "util";
import fs from "fs";
import { execSync } from "node:child_process";

const commitHash = execSync("git rev-parse HEAD").toString().trim();
// magic tools to extract
function extractLocation(stack) {
    if (!stack) return null;

    const lines = stack.split("\n");

    for (const line of lines) {
        const trimmed = line.trim();

        if (trimmed.includes("node:internal")) continue;

        let match = trimmed.match(/^at (file:\/\/\/.*):(\d+):(\d+)/);

        if (match) {
            return {
                file: match[1],
                line: match[2],
                column: match[3],
            };
        }

        match =
            trimmed.match(/^at (\/.*):(\d+):(\d+)/) ||
            trimmed.match(/^at ([A-Za-z]:\\.*):(\d+):(\d+)/);

        if (match) {
            return {
                file: match[1],
                line: match[2],
                column: match[3],
            };
        }

        match = trimmed.match(/^at \(?(file:\/\/\/.*):(\d+):(\d+)\)?/);

        if (match) {
            return {
                file: match[1],
                line: match[2],
                column: match[3],
            };
        }
    }

    return null;
}
function convertFileUrlToUrl(fileurl) {
    if (!fileurl.startsWith("file:")) return null;
    return fileurl.replace("file://", "").replace(process.cwd(), "")
}
function handleError(e, promis) {
    const fullReport = util.inspect(e, {
        showHidden: true,
        showProxy: true,
        depth: 2,
        colors: false,
        breakLength: 120,
    });
    const locationExtraction = extractLocation(e.stack)

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

    console.log(errorReport, convertFileUrlToUrl(locationExtraction.file));
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

throw new Error("Ballistic missle inbound!");
