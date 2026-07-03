import { NextResponse } from "next/server";
import { RunNotFoundError, getRunRepository } from "@/lib/server/runs";
import { buildRunReceipt, renderRunReceiptMarkdown } from "@/lib/run-receipt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Local run export: a JSON receipt, the final unified patch, or a Markdown
 * summary. Returned as a download so the user can keep a record of the run.
 */
export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  const format = new URL(request.url).searchParams.get("format") ?? "json";

  try {
    const run = await getRunRepository().get(id);
    const slug = id.slice(0, 8);

    if (format === "patch") {
      const patch = run.finalPatch;
      if (patch === undefined || patch.trim().length === 0) {
        return NextResponse.json({ error: "This run has no final patch to export." }, { status: 404 });
      }
      return download(patch, `manyhands-run-${slug}.patch`, "text/x-patch; charset=utf-8");
    }

    if (format === "md" || format === "markdown") {
      const markdown = renderRunReceiptMarkdown(buildRunReceipt(run));
      return download(markdown, `manyhands-run-${slug}.md`, "text/markdown; charset=utf-8");
    }

    if (format === "json") {
      const body = JSON.stringify(buildRunReceipt(run), null, 2);
      return download(body, `manyhands-run-${slug}.json`, "application/json; charset=utf-8");
    }

    return NextResponse.json({ error: `Unsupported export format "${format}"` }, { status: 400 });
  } catch (error) {
    if (error instanceof RunNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

function download(body: string, filename: string, contentType: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": contentType,
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store"
    }
  });
}
