// Echoes the arguments the oracle actually delivered, so a test can prove the
// published `pnpm study:probe -- --increment Wn ...` command survives spawning.
const arg = (flag) => { const index = process.argv.indexOf(flag); return index === -1 ? undefined : process.argv[index + 1]; };
process.stdout.write(`${JSON.stringify({
  increment: arg("--increment"),
  scenario: arg("--scenario"),
  format: arg("--format")
})}\n`);
