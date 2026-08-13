import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createWindowsIpcAclProtector,
  createWindowsIpcAclVerifier
} from "../apps/daemon/src/windows-ipc-acl.js";

const execFileAsync = promisify(execFile);
const windowsDescribe = process.platform === "win32" ? describe : describe.skip;

windowsDescribe("Windows IPC capability ACL protection", () => {
  let fixtureRoot: string;
  let helperPath: string;

  beforeAll(async () => {
    fixtureRoot = await mkdtemp(path.join(tmpdir(), "manyhands-ipc-acl-"));
    helperPath = path.join(fixtureRoot, "manyhands-windows-ipc-acl.exe");
    await execFileAsync("rustc.exe", [
      "--edition=2021",
      path.resolve("native/windows-ipc-acl/src/main.rs"),
      "-o",
      helperPath
    ], { windowsHide: true });
  }, 60_000);

  afterAll(async () => {
    if (fixtureRoot !== undefined) {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it.each([
    ["directory" as const],
    ["file" as const]
  ])("replaces a permissive %s DACL and detects later permission drift", async (kind) => {
    const targetPath = path.join(fixtureRoot, `target-${kind}`);
    if (kind === "directory") await mkdir(targetPath);
    else await writeFile(targetPath, "capability-placeholder\n", "utf8");
    await grantEveryoneFullControl(targetPath, kind);

    const verify = createWindowsIpcAclVerifier(helperPath);
    const protect = createWindowsIpcAclProtector(helperPath);

    await expect(verify(targetPath, kind)).rejects.toThrow(/acl verification failed/i);
    await expect(protect(targetPath, kind)).resolves.toBeUndefined();
    await expect(verify(targetPath, kind)).resolves.toBeUndefined();

    await grantEveryoneFullControl(targetPath, kind);
    await expect(verify(targetPath, kind)).rejects.toThrow(/acl verification failed/i);
  });

  it("rejects a directory reparse point instead of following it", async () => {
    const realDirectory = path.join(fixtureRoot, "real-directory");
    const junction = path.join(fixtureRoot, "directory-junction");
    await mkdir(realDirectory);
    await symlink(realDirectory, junction, "junction");

    const protect = createWindowsIpcAclProtector(helperPath);
    const verify = createWindowsIpcAclVerifier(helperPath);

    await expect(protect(junction, "directory")).rejects.toThrow(/reparse point/i);
    await expect(verify(junction, "directory")).rejects.toThrow(/reparse point/i);
  });
});

async function grantEveryoneFullControl(
  targetPath: string,
  kind: "directory" | "file"
): Promise<void> {
  const script = String.raw`
$ErrorActionPreference = 'Stop'
$targetPath = $env:MANYHANDS_ACL_TEST_TARGET
$kind = $env:MANYHANDS_ACL_TEST_KIND
$acl = Get-Acl -LiteralPath $targetPath
$everyone = [System.Security.Principal.SecurityIdentifier]::new('S-1-1-0')
$inheritance = if ($kind -eq 'directory') {
  [System.Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'
} else {
  [System.Security.AccessControl.InheritanceFlags]::None
}
$rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
  $everyone,
  [System.Security.AccessControl.FileSystemRights]::FullControl,
  $inheritance,
  [System.Security.AccessControl.PropagationFlags]::None,
  [System.Security.AccessControl.AccessControlType]::Allow
)
$acl.AddAccessRule($rule)
(Get-Item -LiteralPath $targetPath).SetAccessControl($acl)
`;
  await execFileAsync("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    script
  ], {
    windowsHide: true,
    env: {
      ...process.env,
      MANYHANDS_ACL_TEST_TARGET: targetPath,
      MANYHANDS_ACL_TEST_KIND: kind
    }
  });
}
