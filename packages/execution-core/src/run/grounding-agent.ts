import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeFile } from "node:fs/promises";
import { GeminiCliExecutor } from "../executor/gemini-cli.js";
import { SimpleGitRunner } from "../git/runner.js";
import type { TaskGraph } from "@manyhands/task-graph";
import type { InterfaceContract } from "@manyhands/contracts";

export interface GroundingAgentParams {
  repoRoot: string;
  graph: TaskGraph;
  model: string;
  runId: string;
}

export class GroundingAgent {
  private readonly executor: GeminiCliExecutor;
  private readonly git: SimpleGitRunner;

  constructor() {
    this.executor = new GeminiCliExecutor();
    this.git = new SimpleGitRunner();
  }

  async run(params: GroundingAgentParams): Promise<string> {
    // Collect all produced interfaces from the graph
    const interfaces: InterfaceContract[] = [];
    for (const node of Object.values(params.graph.nodes)) {
      if (node.contract?.producedInterfaces) {
        interfaces.push(...node.contract.producedInterfaces);
      }
    }

    if (interfaces.length === 0) {
      // No interfaces to ground, return current HEAD commit
      return this.git.head(params.repoRoot);
    }

    // Formulate a prompt for the GroundingAgent
    const prompt = [
      "You are the ManyHands GroundingAgent.",
      "Your task is to scaffold a 'walking skeleton' for the approved feature plan.",
      "You must create all the interface files described below, containing only the necessary imports, empty types/classes, or minimal function signatures (e.g. export function foo() { throw new Error('Not implemented'); } or empty interfaces) so that other parallel coding subagents can import and build against them without compilation errors.",
      "",
      "=== INTERFACES TO SCAFFOLD ===",
      ...interfaces.map(i => {
        return `- File: ${i.id} (${i.kind})\n  Signature: ${i.signature}\n  Description: ${i.description}`;
      }),
      "",
      "Instructions:",
      "1. Do NOT write full implementations. Write only the scaffolding (interfaces, signatures, types, empty functions).",
      "2. Write these files directly into the repository workspace at their correct paths.",
      "3. Do NOT commit the changes. The orchestrator will commit them."
    ].join("\n");

    const instructionFilePath = join(tmpdir(), `mh-grounding-${params.runId}.txt`);
    await writeFile(instructionFilePath, prompt, "utf8");

    // Execute the agent in the repoRoot
    const executorOutcome = await this.executor.execute({
      cwd: params.repoRoot,
      instructionFilePath,
      model: params.model,
      timeoutMs: 300_000,
      sandboxMode: "workspace-write",
      bypassApprovals: true
    });

    if (executorOutcome.exitCode !== 0 || executorOutcome.timedOut) {
      throw new Error(`GroundingAgent failed with exit code ${executorOutcome.exitCode}`);
    }

    // Commit the changes on behalf of the orchestrator (D6)
    await this.git.addAll(params.repoRoot);
    const diff = await this.git.diffCached(params.repoRoot);
    if (diff.trim().length === 0) {
      // No files were created/changed by the grounding agent
      return this.git.head(params.repoRoot);
    }

    const commitSha = await this.git.commit({
      cwd: params.repoRoot,
      message: "mh-grounding: walking skeleton scaffold"
    });

    return commitSha;
  }
}
