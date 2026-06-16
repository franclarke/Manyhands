import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  ClaudeCodeRecursiveDecomposer,
  DecomposerQuestionError,
  isDecomposerQuestionError,
  type FeatureRequest
} from "@manyhands/decomposer";

const FEATURE: FeatureRequest = {
  id: "interactive-feature",
  title: "Interactive feature",
  description: "A feature that will prompt questions",
  targetStack: ["typescript"],
  constraints: [],
  acceptanceCriteria: ["works"]
};

/** Wraps a step value inside the Claude Code `--output-format json` envelope. */
function resultEnvelope(stepValue: unknown): string {
  return JSON.stringify({ type: "result", is_error: false, result: JSON.stringify(stepValue) });
}

describe("ClaudeCodeRecursiveDecomposer - Interactive Planning", () => {
  it("throws DecomposerQuestionError when LLM returns a question decision", async () => {
    const decomposer = new ClaudeCodeRecursiveDecomposer({
      model: "sonnet",
      userPrompt: "prompt questions",
      cwd: process.cwd(),
      spawn: fakeClaudeSpawn({
        decision: "question",
        reasoning: "ambiguous database requirements",
        question: "Do you want to use MongoDB or PostgreSQL?",
        options: ["MongoDB", "PostgreSQL"]
      }),
      useShell: false
    });

    try {
      await decomposer.decompose(FEATURE);
      throw new Error("expected DecomposerQuestionError, but it completed");
    } catch (error) {
      expect(isDecomposerQuestionError(error)).toBe(true);
      const qErr = error as DecomposerQuestionError;
      expect(qErr.nodeId).toBe("root");
      expect(qErr.question).toBe("Do you want to use MongoDB or PostgreSQL?");
      expect(qErr.options).toEqual(["MongoDB", "PostgreSQL"]);
      expect(qErr.stepCache["root"]).toBeDefined();
      expect(qErr.stepCache["root"].decision).toBe("question");
    }
  });

  it("injects previous user answer and completes when run with caching and answers", async () => {
    let capturedPrompt = "";

    const decomposer = new ClaudeCodeRecursiveDecomposer({
      model: "sonnet",
      userPrompt: "prompt questions",
      cwd: process.cwd(),
      spawn: (_command, _args, _options): ChildProcess => {
        // Interceptamos la llamada para capturar el prompt enviado
        const child = new EventEmitter() as EventEmitter & {
          stdin: PassThrough;
          stdout: PassThrough;
          stderr: PassThrough;
          kill: () => boolean;
        };
        child.stdin = new PassThrough();
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        child.kill = () => true;

        let stdinData = "";
        child.stdin.on("data", (chunk) => {
          stdinData += chunk.toString("utf8");
        });

        setTimeout(() => {
          capturedPrompt = stdinData;
          // Devolvemos una decisión final atómica después de recibir la respuesta
          child.stdout.write(resultEnvelope({
            decision: "atomic",
            reasoning: "implemented with PostgreSQL as requested",
            allowedPaths: ["src/**"],
            forbiddenPaths: [],
            expectedFiles: ["src/db.ts"],
            acceptanceCriteria: ["works"]
          }));
          child.emit("close", 0);
        }, 0);

        return child as never;
      },
      useShell: false
    });

    // Simulamos que el caché ya tiene la pregunta pendiente para el nodo 'root'
    const stepCache = {
      root: {
        decision: "question",
        reasoning: "ambiguous database",
        question: "Do you want to use MongoDB or PostgreSQL?",
        options: ["MongoDB", "PostgreSQL"]
      }
    };

    // Simulamos que el usuario ya respondió 'PostgreSQL'
    const questionAnswers = {
      root: "PostgreSQL"
    };

    const result = await decomposer.decompose(FEATURE, {
      mode: "balanced",
      questionAnswers,
      stepCache
    });

    // Verificamos que el prompt inyectó el feedback
    expect(capturedPrompt).toContain('You previously asked: "Do you want to use MongoDB or PostgreSQL?"');
    expect(capturedPrompt).toContain('The user responded: "PostgreSQL"');

    // Verificamos que terminó exitosamente usando la respuesta
    expect(result.graph.nodes["root-impl"]).toBeDefined();
    expect(result.contracts[0]?.expectedOutput.changedFiles).toEqual(["src/db.ts"]);
  });
});

function fakeClaudeSpawn(stepValue: unknown, exitCode = 0, stderrValue = "") {
  return (_command: string, args: readonly string[], _options: SpawnOptions): ChildProcess => {
    const child = new EventEmitter() as EventEmitter & {
      stdin: PassThrough;
      stdout: PassThrough;
      stderr: PassThrough;
      kill: () => boolean;
    };
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    setTimeout(() => {
      child.stdout.write(resultEnvelope(stepValue));
      if (stderrValue.length > 0) child.stderr.write(stderrValue);
      child.emit("close", exitCode);
    }, 0);
    return child as never;
  };
}
