# Deterministic Decomposer

## Purpose

Phase 2 adds the first ManyHands decomposer without using LLMs. The goal is to validate the domain flow and the experimental granularity axis before introducing model cost, prompt variability or external dependencies.

## Interface

`@manyhands/decomposer` exports:

- `FeatureRequestSchema` and `FeatureRequest`;
- `DecompositionModeSchema` and `DecompositionMode`;
- `DecompositionOptions`;
- `DecompositionResult`;
- `Decomposer`;
- `MockDecomposer`.

The interface is async so a future LLM-backed decomposer can replace the mock without changing callers.

## Granularity

The mock supports three deterministic modes:

- `coarse`: 3 larger leaf tasks.
- `balanced`: 7 medium leaf tasks, the recommended demo mode.
- `fine`: 10 smaller leaf tasks.

`balanced` maps to the existing task graph granularity value `medium`. The external mode name stays `balanced` because it describes the intended decomposition strategy for experiments.

## Current Fixture

The initial fixture is `examples/features/passwordless-login.json`. It models a passwordless login flow with magic links:

- request UI;
- token model and persistence;
- request action;
- callback validation;
- session bridge;
- feedback states;
- focused tests.

The fixture does not require a target app to exist. It is a laboratory input for validating graph, contract, risk and scheduling behavior.

## Limitations

- No LLM prompt or model call.
- No repo inspection.
- No TypeScript Compiler API analysis.
- No real code generation.
- No human graph editor yet.
- No UI rendering in this phase.

These limits are deliberate. They keep the decomposer reproducible and unit-testable.
