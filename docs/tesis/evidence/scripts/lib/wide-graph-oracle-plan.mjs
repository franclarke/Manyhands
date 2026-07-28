export const wideGraphOracleCommands = [
  ["install", "--frozen-lockfile"],
  ["test"],
  ["typecheck"],
  ["build"]
];

export function wideGraphCloneArgs(sourceRepository, destination) {
  return [
    "-c",
    `safe.directory=${sourceRepository}`,
    "clone",
    "--no-hardlinks",
    sourceRepository,
    destination
  ];
}
