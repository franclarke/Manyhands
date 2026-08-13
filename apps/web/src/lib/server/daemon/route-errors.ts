import { ZodError } from "zod";
import { NextResponse } from "next/server";

import { LocalIpcRemoteError } from "./local-ipc-client";
import { RunValidationError } from "@/lib/server/runs/errors";

export function daemonQueryErrorResponse(error: unknown): NextResponse {
  if (error instanceof LocalIpcRemoteError && error.code === "request_failed") {
    return NextResponse.json({ error: "Run not found." }, { status: 404 });
  }
  return daemonCommonErrorResponse(error);
}

export function daemonMutationErrorResponse(error: unknown): NextResponse {
  if (error instanceof LocalIpcRemoteError && error.code === "request_failed") {
    return NextResponse.json({ error: "The daemon rejected the command." }, { status: 409 });
  }
  return daemonCommonErrorResponse(error);
}

function daemonCommonErrorResponse(error: unknown): NextResponse {
  if (error instanceof ZodError || error instanceof SyntaxError || error instanceof TypeError
    || error instanceof RunValidationError) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
  return NextResponse.json({
    error: error instanceof Error ? error.message : String(error)
  }, { status: 503 });
}
