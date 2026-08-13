import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

// GR uses a real process tree while keeping planner/executor behavior fully
// deterministic and offline. The grandchild inherits the supervisor Job
// Object; cancellation must prove both identities are gone before the actor
// publishes operation.interrupted.
const grandchild = spawn(process.execPath, [
  "-e",
  "setInterval(() => {}, 1000)"
], {
  shell: false,
  stdio: "ignore"
});

grandchild.once("error", (error) => {
  process.stderr.write(`deterministic fake grandchild failed: ${error.message}\n`);
  process.exitCode = 1;
});

const evidencePath = process.env.MANYHANDS_FAKE_PID_EVIDENCE;
if (evidencePath !== undefined) {
  writeFileSync(evidencePath, JSON.stringify({
    child: process.pid,
    grandchild: grandchild.pid
  }));
}

setInterval(() => {}, 1000);
