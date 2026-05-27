# Scope Validation

## Purpose

Scope validation enforces the binding part of an `AgentTaskContract`: a task may only touch declared paths and must report the expected files, symbols and validation commands.

The implementation lives in `@manyhands/scope-validation` so both mock and future real runners can reuse it.

## Inputs

`validateScope` receives:

- an `AgentTaskContract`;
- changed files reported by the runner;
- symbols reported by the runner;
- validation commands reported as executed.

## Violations

The validator detects:

- `forbidden_path_touched`;
- `outside_allowed_scope`;
- `missing_expected_file`;
- `missing_expected_symbol`;
- `undeclared_critical_path`;
- `missing_required_validation`.

Forbidden paths and undeclared critical paths are blocking. Missing expected files, symbols and validation commands are errors. A max files touched overflow is a warning.

## Path Matching

The matcher is intentionally small and deterministic. It supports normalized paths plus `*` and `**`, which covers the current contract patterns. It is not a complete glob engine.

## Limitations

This validation only checks declared metadata. It does not inspect actual code, ASTs, runtime behavior or git diffs.
