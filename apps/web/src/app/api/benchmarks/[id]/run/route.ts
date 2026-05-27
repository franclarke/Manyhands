import { NextResponse } from "next/server";
import type { BenchmarkRunRequest } from "@/lib/api-types";
import {
  BenchmarkNotFoundError,
  BenchmarkSelectionError,
  runBenchmark
} from "@/lib/server/benchmarks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{
    id: string;
  }>;
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const body = await readJsonBody(request);
    const result = await runBenchmark(id, body.config);

    return NextResponse.json(result);
  } catch (error) {
    const status = error instanceof BenchmarkNotFoundError
      ? 404
      : error instanceof SyntaxError || error instanceof BenchmarkSelectionError
        ? 400
        : 500;

    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status }
    );
  }
}

async function readJsonBody(request: Request): Promise<BenchmarkRunRequest> {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return {};
  }

  const parsed = await request.json() as unknown;

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new SyntaxError("Request body must be a JSON object");
  }

  return parsed as BenchmarkRunRequest;
}
