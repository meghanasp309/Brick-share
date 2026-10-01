// Runs when a Claude Code session starts. Prints a short note that Claude
// reads, so it knows the project and whether Docker is up.
const { spawnSync } = require("child_process");

const docker = spawnSync("docker", ["info"], { stdio: "ignore", timeout: 5000 });
const dockerUp = docker.status === 0;

console.log([
  "BrickShare plugin loaded. Project: fractional real-estate marketplace (Besu blockchain, Solidity, Express, PostgreSQL, Next.js).",
  "Commands: /brickshare:demo, /brickshare:test, /brickshare:status, /brickshare:reset.",
  "The user is a student: explain things in short, simple words.",
  dockerUp ? "Docker is running." : "Docker is NOT running. Ask the user to open Docker Desktop before starting the blockchain or running backend tests.",
].join("\n"));
