# Handoff Report — AI Security, Cost & LLM Guardrails Audit

## 1. Observation

Exact code observations:
- **`packages/decomposer/src/llm/recursive/claude-code-recursive-decomposer.ts:176-203`**: System prompt and user message are concatenated as raw text strings without structural XML markers or escaping.
- **`packages/decomposer/src/llm/recursive/recursive-decomposer.ts:47-51, 215-217`**: `DEFAULT_MAX_COST_USD` (1.5) and `DEFAULT_MAX_DURATION_MS` are declared but never passed into options or checked in `expand()`. Max decomposer sub-calls defaults to 500 without financial cap.
- **`packages/decomposer/src/llm/anthropic-decomposer.ts:171-176`**: `capRawResponse()` stores up to 64KB raw LLM response text into `lastResponse.rawResponse` unredacted, which is persisted into `RunRecord`.
- **`packages/decomposer/src/llm/recursive/recursive-decomposer.ts:927-931`**: On parse failure, `responseExcerptOf()` outputs up to 400 characters of raw LLM output to stderr/logs.
- **`packages/decomposer/src/llm/recursive/recursive-decomposer.ts:606-626`**: Subtask expansion uses `mapWithConcurrency(..., maxParallelSteps)` without RPM/TPM rate-limiting or 429 backoff buckets.
- **`packages/decomposer/src/compiler/graph-compiler.ts:140-160`**: LLM-authored validation commands (`parentValidationCommands`, `leafValidationCommands`) are accepted without shell operator or executable whitelisting.
- **`packages/execution-core/src/pricing.ts:27-49`**: `costForModel()` returns `undefined` for unrecognized model IDs, which bypasses downstream budget tracking.

## 2. Logic Chain

1. **Prompt Injection**: LLM prompt templates incorporate developer goals and codebase context directly into text strings without sanitization. An attacker placing prompt manipulation instructions in codebase files or user goals can alter LLM output behavior.
2. **Cost & Rate Limits**: While single-step max tokens and call counts are bounded, no cumulative dollar cost accumulator exists during recursive expansion. An agent with `maxDecomposerCalls: 500` can consume $50+ of LLM tokens before stopping.
3. **Log Sanitization**: Raw model responses containing ingested workspace secrets or user credentials are buffered into memory and saved directly to disk without secret masking.
4. **Command Boundaries**: LLM output parsing validates schema structure (Zod), but does not sanitize LLM-suggested shell commands, creating an execution vector if an LLM generates unsafe command arguments.

## 3. Caveats

- CLI binary sandboxing (Claude Code `--permission-mode plan`, Codex `--sandbox workspace-write`) relies on external host CLI tools behaving correctly.
- Dynamic network mode tests were not executed due to CODE_ONLY environment restrictions; code analysis based on static inspection.

## 4. Conclusion

Seven distinct vulnerabilities (`MH-AUDIT-AI-001` through `MH-AUDIT-AI-007`) were identified across prompt formatting, budget enforcement, log sanitization, rate limiting, and command validation. Detailed remediation strategies have been documented in `report.md`.

## 5. Verification Method

- Inspect `packages/decomposer/src/llm/recursive/claude-code-recursive-decomposer.ts:176-203` to verify missing XML tags and raw concatenation.
- Inspect `packages/decomposer/src/llm/recursive/recursive-decomposer.ts:47-51` to confirm `DEFAULT_MAX_COST_USD` is unused.
- Inspect `packages/decomposer/src/llm/anthropic-decomposer.ts:171-176` for unredacted raw response storage.
