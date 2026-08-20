import { stat, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

/**
 * Ensures required native Windows binaries (Job Runner and IPC ACL helper)
 * are built and available in `.manyhands/bin/`.
 */
export async function ensureNativeBinaries(options = {}) {
  if (process.platform !== "win32") {
    return { jobRunner: undefined, ipcHelper: undefined };
  }

  const baseDir = options.cwd ?? process.cwd();
  const binDir = path.join(baseDir, ".manyhands", "bin");
  await mkdir(binDir, { recursive: true });

  const jobRunner = await ensureBinary({
    name: "windows-job-runner",
    source: path.join(baseDir, "native", "windows-job-runner", "src", "main.rs"),
    target: path.join(binDir, "manyhands-windows-job-runner.exe"),
    baseDir
  });

  const ipcHelper = await ensureBinary({
    name: "windows-ipc-acl",
    source: path.join(baseDir, "native", "windows-ipc-acl", "src", "main.rs"),
    target: path.join(binDir, "manyhands-windows-ipc-acl.exe"),
    baseDir
  });

  return { jobRunner, ipcHelper };
}

async function ensureBinary({ name, source, target, baseDir }) {
  try {
    const sourceStat = await stat(source);
    const targetStat = await stat(target).catch(() => undefined);

    if (targetStat !== undefined && targetStat.mtimeMs >= sourceStat.mtimeMs) {
      return target;
    }

    // Try rustc first
    const built = await compileWithRustc(source, target, baseDir);
    if (built) return target;

    // Fallback to cargo
    const cargoBuilt = await compileWithCargo(name, baseDir);
    if (cargoBuilt) return target;

    return undefined;
  } catch {
    return undefined;
  }
}

function compileWithRustc(source, target, cwd) {
  return new Promise((resolve) => {
    const compiler = spawn("rustc.exe", ["--edition=2021", source, "-O", "-o", target], {
      cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    compiler.once("error", () => resolve(false));
    compiler.once("exit", (code) => resolve(code === 0));
  });
}

function compileWithCargo(crateName, cwd) {
  return new Promise((resolve) => {
    const manifestPath = path.join(cwd, "native", crateName, "Cargo.toml");
    const compiler = spawn("cargo.exe", ["build", "--release", "--manifest-path", manifestPath], {
      cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    compiler.once("error", () => resolve(false));
    compiler.once("exit", (code) => resolve(code === 0));
  });
}

// Direct CLI execution: `node scripts/ensure-native-binaries.mjs`
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/i, "$1"))) {
  ensureNativeBinaries()
    .then((result) => {
      if (result.jobRunner) console.log(`[native] Job runner ready: ${result.jobRunner}`);
      if (result.ipcHelper) console.log(`[native] IPC ACL helper ready: ${result.ipcHelper}`);
    })
    .catch((err) => {
      console.error(`[native] Error building binaries: ${err.message}`);
      process.exit(1);
    });
}
