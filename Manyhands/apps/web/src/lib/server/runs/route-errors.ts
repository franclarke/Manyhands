import { NextResponse } from "next/server";
import {
  RunLifecycleError,
  RunMutationConflictError,
  RunNotFoundError,
  RunValidationError
} from "./errors";

/**
 * Map run-domain errors to HTTP responses. Mutation conflicts (lost race,
 * stale gate, stale version) return a structured 409 so the client can
 * reconcile (refetch the run) instead of retrying blindly.
 */
export function runErrorResponse(error: unknown): NextResponse {
  if (error instanceof RunNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof RunValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof RunMutationConflictError) {
    return NextResponse.json(
      {
        error: error.message,
        conflict: { currentStatus: error.currentStatus, currentVersion: error.currentVersion }
      },
      { status: 409 }
    );
  }
  if (error instanceof RunLifecycleError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  return NextResponse.json(
    { error: error instanceof Error ? error.message : String(error) },
    { status: 500 }
  );
}
