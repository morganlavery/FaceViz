import { spawn } from "node:child_process";

const [edition, command, ...args] = process.argv.slice(2);

if (!["demo", "paid"].includes(edition) || !command) {
  console.error("Usage: node scripts/run-with-edition.mjs <demo|paid> <command> [...args]");
  process.exit(1);
}

const executable = process.platform === "win32" && command === "npm" ? "npm.cmd" : command;
const env = {
  ...process.env,
  VITE_INFINIGHT_EDITION: edition
};

if (process.platform === "win32") {
  for (const key of Object.keys(env)) {
    if (!key || key.startsWith("=")) {
      delete env[key];
    }
  }
}

const child = spawn(executable, args, {
  env,
  stdio: "inherit"
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
