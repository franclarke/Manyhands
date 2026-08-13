import { describe, expect, it } from "vitest";
import { buildSemanticPlan } from "@manyhands/contracts";
import { ResourceCatalog } from "@manyhands/repository-index";
import { compilePlan, verifyPlan } from "@manyhands/decomposer";
import { stage5Fixture, stage5Sha256 } from "./helpers/stage5-fixture.js";

const ids = (kind: string, parts: readonly string[]) => [kind, ...parts].join(":");

describe("Stage 5 GP0 fixture and adverse matrix", () => {
  it("accepts tiny and cross-boundary plans", () => {
    const crossBoundary = stage5Fixture();
    expect(compilePlan({ ...crossBoundary, hasher: stage5Sha256, idFactory: ids }).ok).toBe(true);

    const material = planMaterial(crossBoundary);
    const root = material.units["unit:root"]!;
    root.role = "leaf";
    root.expansion = "leaf";
    root.granularity = {
      ...material.units["unit:a"]!.granularity,
      disposition: "leaf",
      integrationObligationId: undefined
    };
    root.integration = undefined;
    root.repositorySurface = { resourceRefs: ["resource:a"], pathHints: ["src/a.ts"] };
    const sourceIntent = material.units["unit:a"]!.resourceIntents[0]!;
    if (sourceIntent.access !== "modify") throw new Error("fixture source intent must modify");
    root.resourceIntents = [{
      ...sourceIntent,
      outputArtifactId: "artifact:root"
    }];
    root.consumes = [];
    root.produces = ["artifact:root"];
    root.seamRefs = [];
    material.units = { "unit:root": root };
    material.artifacts = {
      "artifact:root": {
        id: "artifact:root",
        producerUnitId: "unit:root",
        consumerUnitIds: [],
        artifactType: "source_change",
        materialization: "patch",
        expectedPaths: ["src/a.ts"]
      }
    };
    material.seams = {};
    const plan = buildSemanticPlan(material, stage5Sha256);
    expect(compilePlan({ ...crossBoundary, plan, hasher: stage5Sha256, idFactory: ids }).ok).toBe(true);
  });

  it("rejects direct writes to generated resources", () => {
    const fixture = stage5Fixture();
    const generated = catalogFrom(fixture, {
      "resource:a": {
        ...fixture.repositoryView.catalog.resources["resource:a"]!,
        generated: { state: "generated", reason: "Generated output.", evidenceRefs: ["evidence:generator"] }
      }
    });
    const { plan, repositoryView } = bindCatalog(fixture, generated, "generated");
    expect(verifyPlan({ ...fixture, plan, repositoryView, hasher: stage5Sha256 }).findings.map(({ code }) => code))
      .toContain("generated_resource_write");
  });

  it("R4 rejects ambiguous ownership and unknown write overlap", () => {
    const fixture = stage5Fixture();
    const shared = fixture.repositoryView.catalog.resources["resource:a"]!;
    const ambiguousCatalog = catalogFrom(fixture, {
      "resource:shared-a": { ...shared, id: "resource:shared-a", canonicalLocator: "path:shared" },
      "resource:shared-b": { ...shared, id: "resource:shared-b", canonicalLocator: "path:shared" }
    }, ["resource:a"]);
    const ambiguous = bindCatalog(fixture, ambiguousCatalog, "ambiguous", (material) => {
      material.units["unit:a"]!.resourceIntents[0]!.resourceId = "path:shared";
    });
    expect(verifyPlan({ ...fixture, ...ambiguous, hasher: stage5Sha256 }).findings.map(({ code }) => code))
      .toContain("resource_unresolved");

    const unknownCatalog = catalogFrom(fixture, {
      "resource:b": {
        ...fixture.repositoryView.catalog.resources["resource:b"]!,
        epistemic: { state: "unknown", reason: "Boundary coverage is partial.", evidenceRefs: [] }
      }
    });
    const unknown = bindCatalog(fixture, unknownCatalog, "unknown-overlap");
    expect(verifyPlan({ ...fixture, ...unknown, hasher: stage5Sha256 }).findings.map(({ code }) => code))
      .toContain("resource_overlap_unknown");
  });

  it("R5 rejects missing proof authority before compilation", () => {
    const fixture = stage5Fixture();
    const result = compilePlan({ ...fixture, proofStrategies: [], hasher: stage5Sha256, idFactory: ids });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.findings.map(({ code }) => code)).toContain("required_criterion_uncovered");
  });
});

function planMaterial(fixture: ReturnType<typeof stage5Fixture>) {
  const material = structuredClone(fixture.plan);
  Reflect.deleteProperty(material, "digest");
  return material;
}

function catalogFrom(
  fixture: ReturnType<typeof stage5Fixture>,
  replacements: Record<string, typeof fixture.repositoryView.catalog.resources[string]>,
  remove: string[] = []
): ResourceCatalog {
  const resources = { ...fixture.repositoryView.catalog.resources, ...replacements };
  remove.forEach((id) => delete resources[id]);
  return new ResourceCatalog({
    schemaVersion: 1,
    repositoryContentDigest: fixture.repositoryView.catalog.repositoryContentDigest,
    resources,
    contains: [...fixture.repositoryView.catalog.contains],
    aliases: [...fixture.repositoryView.catalog.aliases],
    coverage: { ...fixture.repositoryView.catalog.coverage }
  });
}

function bindCatalog(
  fixture: ReturnType<typeof stage5Fixture>,
  catalog: ResourceCatalog,
  suffix: string,
  mutate: (material: ReturnType<typeof planMaterial>) => void = () => undefined
) {
  const repositoryView = {
    ...fixture.repositoryView,
    catalog,
    resourceCatalogDigest: catalog.digest,
    digest: `sha256:view-${suffix}`
  };
  const material = planMaterial(fixture);
  material.repositoryView = {
    digest: repositoryView.digest,
    treeSha: repositoryView.treeSha,
    resourceCatalogDigest: catalog.digest
  };
  mutate(material);
  return { repositoryView, plan: buildSemanticPlan(material, stage5Sha256) };
}
