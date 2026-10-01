// Shared helper: Claude Code sends the hook's details as JSON on stdin.
// Returns that JSON, plus the edited file's path relative to the project.
const path = require("path");

function readInput() {
  return new Promise((resolve) => {
    let raw = "";
    process.stdin.on("data", (d) => (raw += d));
    process.stdin.on("end", () => {
      let input = {};
      try { input = JSON.parse(raw); } catch { /* no input: nothing to check */ }
      const root = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
      const file = input.tool_input && input.tool_input.file_path;
      // Always use "/" so the rules work the same on Windows and Mac/Linux.
      const rel = file ? path.relative(root, path.resolve(root, file)).split(path.sep).join("/") : "";
      resolve({ input, root, file, rel });
    });
  });
}

module.exports = { readInput };
