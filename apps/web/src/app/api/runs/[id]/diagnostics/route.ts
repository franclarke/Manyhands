import { NextResponse } from "next/server";
import { buildRunDiagnostics } from "@/lib/server/runs/diagnostics";
import { RunNotFoundError } from "@/lib/server/runs/errors";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    return NextResponse.json(await buildRunDiagnostics(id), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof RunNotFoundError) return NextResponse.json({ error: "run_not_found" }, { status: 404 });
    return NextResponse.json({ error: "diagnostics_unavailable" }, { status: 500 });
  }
}
