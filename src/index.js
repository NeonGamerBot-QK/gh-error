import { execSync } from "node:child_process";
import util from "util";
import { Octokit } from "octokit";
import { stableHashIgnoringVolatile } from "./part/hash.js";
import { extractLocation, convertFileUrlToUrl, generateMermaid } from "./part/util.js";

export { stableHashIgnoringVolatile, extractLocation, convertFileUrlToUrl, generateMermaid };

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
