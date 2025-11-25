const octokit = require("octokit");
const util = require("util");
process.on("uncaughtException", (e) => {});
process.on("unhandledRejection");

function handleError(e) {
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
  };
}
