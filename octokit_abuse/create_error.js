import "dotenv/config";
// octokit what the fuck
import { Octokit } from "octokit";
import util from "util";
import { execSync } from "node:child_process";
const gh = new Octokit({
  auth: process.env.GH_PAT,
});

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
        const isNotPlanned = x.locked || x.state_reason === "not_planned";
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
      body: [
        `⚠️ Still an active issue.`,
        ``,
        `Error occurred at: ${new Date().toISOString()}`,
        `Commit: ${commitHash}`,
      ].join("\n"),
    });
  } else {
    await gh.rest.issues.create({
      repo: repoName,
      owner: repoOwner,
      labels: ["automated-error", "bug"],
      title: `error: ${errorReport.message}`,
      body: `<!-- hash: ${hash} -->\n<!-- full json or smt: \n ${JSON.stringify(errorReport)} \n -->\n# Error report: ${errorReport.message}\n## Stack: \n\`\`\`\n${errorReport.fullReport || errorReport.stack}\n\`\`\` \n\n${generateMermaid(errorReport)}`,
    });
  }
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

throw new Error("Ballistic missle inbound! numero 2");

// setTimeout(() => {
//     throw new Error("interballistic missle inbound!");
// });
