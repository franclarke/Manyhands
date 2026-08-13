import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
  stdio: "ignore",
  shell: false
});
writeFileSync(process.env.MANYHANDS_FAKE_PID_EVIDENCE, JSON.stringify({
  child: process.pid,
  grandchild: grandchild.pid
}));
setInterval(() => {}, 1000);
