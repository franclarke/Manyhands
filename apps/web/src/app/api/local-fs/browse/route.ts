import { NextResponse } from "next/server";

import { browseLocalDirectories } from "@/lib/server/local-fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const url = new URL(request.url);
    const dir = url.searchParams.get("path") ?? undefined;
    return NextResponse.json(await browseLocalDirectories(dir));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 }
    );
  }
}
