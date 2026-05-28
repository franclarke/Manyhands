# task-manager-api — Benchmark Fixture

A simple Express REST API for task management. Used as the target repository
for ManyHands granularity experiments (ADR-0026).

## Purpose

This is a **partially implemented** API. GET and POST work correctly.
PUT (update) and DELETE are stubbed — they return 404 for every request.
Tests define the expected behavior for all endpoints, including the
unimplemented ones.

An agent's job is to complete the implementation so all tests pass.

## Endpoints

| Method | Path | Status |
|--------|------|--------|
| GET | /health | Implemented |
| GET | /tasks | Implemented |
| GET | /tasks/:id | Implemented |
| POST | /tasks | Implemented |
| PUT | /tasks/:id | **Stub — needs implementation** |
| DELETE | /tasks/:id | **Stub — needs implementation** |

## Setup

```bash
npm install
npm test        # runs vitest — some tests will fail (by design)
npm run dev     # starts the server on port 3001
```

## Structure

```
src/
  index.ts           — Express app setup
  models/task.ts     — Task model + in-memory store
  routes/tasks.ts    — Route handlers
tests/
  tasks.test.ts      — Full test suite (including failing tests for stubs)
```
