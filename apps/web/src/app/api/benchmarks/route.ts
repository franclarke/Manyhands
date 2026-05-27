import { NextResponse } from "next/server";
import { listBenchmarks } from "@/lib/server/benchmarks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const benchmarks = await listBenchmarks();
    return NextResponse.json({ benchmarks });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
