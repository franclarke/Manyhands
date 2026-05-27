# Mock Worktree Runner

## Purpose

Phase 3 introduces a deterministic runner that simulates the lifecycle of executing a leaf task contract. It exists to test ManyHands execution orchestration before real git worktrees, subprocesses or agents are introduced.

## What It Simulates

`MockWorktreeRunner` implements the existing `AgentRunner` interface from `@manyhands/worktree-runner`.

It simulates:

- worktree session metadata;
- branch name;
- task id;
- received contract;
- changed files;
- patch-like diff text;
- validation checks;
- reported symbols;
- scope violations;
- duration and cost metrics;
- success or failure.

## What It Does Not Simulate

It does not:

- call `git`;
- create directories;
- modify repository files;
- run subprocesses;
- invoke Claude Code, Codex, Aider or any LLM;
- perform semantic code analysis;
- apply diffs.

## Determinism

The mock runner derives its default output from `AgentTaskContract.expectedOutput`. Given the same contract and options, it returns the same `AgentRunResult`.

Tests can pass per-task overrides to simulate failure or scope violations without changing the fixture.

## Future Replacement

A real runner should implement the same `AgentRunner` interface and reuse `@manyhands/scope-validation` after collecting real changed files and validation command results.
