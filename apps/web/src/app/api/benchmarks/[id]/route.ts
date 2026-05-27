import { NextResponse } from "next/server";
import {
  BenchmarkNotFoundError,
  getBenchmarkDetail
} from "@/lib/server/benchmarks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{
    id: string;
  }>;
}

export async function GET(_request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const detail = await getBenchmarkDetail(id);

    return NextResponse.json(detail);
  } catch (error) {
    const status = error instanceof BenchmarkNotFoundError ? 404 : 500;

    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status }
    );
  }
}
