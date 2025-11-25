import "dotenv/config";
// octokit what the fuck
// import octokit from "octokit"
import util from "util";
import fs from "fs";
// magic tools to extract
function handleError(e, promis) {
  const fullReport = util.inspect(e, {
    showHidden: true,
    showProxy: true,
    depth: 2,
    colors: false,
    breakLength: 120,
  });

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
  };
  console.log(errorReport);
}
// normal bindings
process.on("uncaughtException", (e) => {
  handleError(e);
});
process.on("unhandledRejection", (e, prom) => {
  handleError(e);
});
// extra
process.on("multipleResolves", (type, prom, value) => {});
process.on("rejectionHandled", (promise) => {});

throw new Error("Ballistic missle inbound!");
