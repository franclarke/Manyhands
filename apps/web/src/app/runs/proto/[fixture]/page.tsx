/**
 * Prototype route (PR 06) — `/runs/proto/<fixture>`.
 *
 * Fixture-first: NO backend, NO `/runs/[runId]` flow. It reproduces a golden
 * fixture through the same model the real UI will consume (runStore + reducer +
 * selectors), to validate the agent-first projection.
 *
 * NOTE: the segment is `proto`, not `_proto`. In the Next App Router an
 * underscore-prefixed folder is a PRIVATE folder excluded from routing (it is why
 * the repo uses `_components`), so `_proto` would not produce a route.
 */
import { notFound } from "next/navigation";
import { GOLDEN_FIXTURE_NAMES, type GoldenFixtureName } from "@/lib/run-model/fixtures";
import { ProtoRunView } from "@/components/run-model/proto-run-view.client";

interface ProtoFixturePageProps {
  params: Promise<{ fixture: string }>;
  /** `?focus=<kind>:<id>` deep-link seed (validated client-side by `parseFocusTarget`). */
  searchParams: Promise<{ focus?: string | string[] }>;
}

export default async function ProtoFixturePage({ params, searchParams }: ProtoFixturePageProps): Promise<React.ReactElement> {
  const { fixture } = await params;
  const { focus } = await searchParams;
  const names: string[] = GOLDEN_FIXTURE_NAMES;
  if (!names.includes(fixture)) {
    notFound();
  }
  const initialFocus = typeof focus === "string" ? focus : undefined;
  return (
    <ProtoRunView
      fixtureName={fixture as GoldenFixtureName}
      {...(initialFocus !== undefined ? { initialFocus } : {})}
    />
  );
}
