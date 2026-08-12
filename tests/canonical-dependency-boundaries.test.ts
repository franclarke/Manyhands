import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ArtifactRequirementSchema,
  ResourceClaimSchema,
  RuntimeLeaseClaimSchema,
  SeamBindingSchema
} from "@manyhands/contracts";

const contractRef = { id: "contract:booking", revision: 1, digest: "sha256:contract" };

describe("canonical dependency boundaries", () => {
  it("keeps contracts browser-safe and independent from legacy core", async () => {
    const packageJson = JSON.parse(await readFile("packages/contracts/package.json", "utf8")) as {
      dependencies?: Record<string, string>;
    };
    expect(packageJson.dependencies).not.toHaveProperty("@manyhands/core");

    const files = (await readdir("packages/contracts/src")).filter((file) => file.endsWith(".ts"));
    const sources = await Promise.all(files.map((file) => readFile(join("packages/contracts/src", file), "utf8")));
    expect(sources.join("\n")).not.toMatch(/from ["']node:/u);
  });

  it("owns the exact canonical graph relation vocabulary without legacy revisions", () => {
    expect(ArtifactRequirementSchema.parse({
      id: "requirement:booking",
      producerNodeId: "node:booking",
      consumerNodeId: "node:web",
      artifactContract: contractRef,
      consumerInputName: "booking-api",
      acceptedManifestKinds: ["change_set"]
    }).artifactContract.revision).toBe(1);

    expect(SeamBindingSchema.safeParse({
      id: "seam-binding:booking",
      producerNodeId: "node:booking",
      consumerNodeId: "node:web",
      seamContract: { ...contractRef, revision: "r1" },
      artifactRequirementId: "requirement:booking",
      validationObligationIds: ["obligation:booking"]
    }).success).toBe(false);

    expect(ResourceClaimSchema.safeParse({
      id: "claim:booking",
      nodeId: "node:booking",
      resourceId: "resource:booking",
      source: "planner",
      evidenceRefs: ["evidence:resource"],
      epistemic: { state: "known", confidence: "high", evidenceRefs: ["evidence:resource"] },
      access: "modify",
      ownerPhase: "implementation",
      inputVersion: { kind: "repository_view", digest: "sha256:view" },
      outputArtifact: contractRef
    }).success).toBe(true);

    expect(RuntimeLeaseClaimSchema.safeParse({
      id: "lease:port",
      nodeId: "node:booking",
      provider: "tcp",
      resourceKey: "127.0.0.1:3100",
      mode: "exclusive",
      phase: "validation"
    }).success).toBe(true);
  });
});
