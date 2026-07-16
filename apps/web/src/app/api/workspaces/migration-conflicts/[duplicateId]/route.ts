import { NextResponse } from "next/server";
import { z } from "zod";
import {
  WorkspaceConflictError,
  WorkspaceNotFoundError,
  WorkspaceValidationError,
  getWorkspaceRepository
} from "@/lib/server/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ duplicateId: string }>;
}

const ResolutionSchema = z.object({
  choice: z.union([z.literal("canonical"), z.literal("duplicate")])
});

export async function PATCH(request: Request, context: RouteContext): Promise<NextResponse> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON" }, { status: 400 });
  }
  const parsed = ResolutionSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'choice must be either "canonical" or "duplicate"' },
      { status: 400 }
    );
  }

  const { duplicateId } = await context.params;
  try {
    const result = await getWorkspaceRepository().resolveMigrationConflict(
      duplicateId,
      parsed.data.choice
    );
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof WorkspaceNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof WorkspaceValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof WorkspaceConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
