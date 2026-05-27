import { NextResponse } from "next/server";
import {
  BenchmarkNotFoundError,
  BenchmarkSelectionError,
  getDemoRunSnapshot,
  type DemoRunSnapshotOptions
} from "@/lib/server/benchmarks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const url = new URL(request.url);
    const options: DemoRunSnapshotOptions = {};
    const benchmarkId = optionalQueryValue(url, "benchmark");
    const config = optionalQueryValue(url, "config");
    const featureId = optionalQueryValue(url, "feature");

    if (benchmarkId !== undefined) {
      options.benchmarkId = benchmarkId;
    }

    if (config !== undefined) {
      options.config = config;
    }

    if (featureId !== undefined) {
      options.featureId = featureId;
    }

    const snapshot = await getDemoRunSnapshot(options);

    return NextResponse.json(snapshot);
  } catch (error) {
    const status = error instanceof BenchmarkNotFoundError
      ? 404
      : error instanceof BenchmarkSelectionError
        ? 400
        : 500;

    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status }
    );
  }
}

function optionalQueryValue(url: URL, key: string): string | undefined {
  const value = url.searchParams.get(key);
  return value === null || value.trim() === "" ? undefined : value;
}
