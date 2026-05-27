module.exports = {
  root: true,
  ignorePatterns: ["next-env.d.ts"],
  extends: ["next/core-web-vitals", "next/typescript"],
  rules: {
    "@typescript-eslint/consistent-type-imports": "error",
    "@typescript-eslint/no-unused-vars": [
      "error",
      {
        "argsIgnorePattern": "^_"
      }
    ]
  }
};
