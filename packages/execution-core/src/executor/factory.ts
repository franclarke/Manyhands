import { ClaudeCodeCliExecutor, type ClaudeCodeCliExecutorDeps } from "./claude-code-cli";
import { GeminiCliExecutor, type GeminiCliExecutorDeps } from "./gemini-cli";
import {
  CLAUDE_CODE_EXECUTOR_ID,
  GEMINI_EXECUTOR_ID,
  getExecutorDescriptor,
  type ExecutorId,
  type ExecutorSelection
} from "./registry";
import type { AgentExecutor } from "./types";

export interface AgentExecutorFactory {
  create(selection: ExecutorSelection): AgentExecutor;
}

export interface DefaultAgentExecutorFactoryDeps {
  gemini?: GeminiCliExecutorDeps;
  claude?: ClaudeCodeCliExecutorDeps;
}

export class DefaultAgentExecutorFactory implements AgentExecutorFactory {
  private readonly deps: DefaultAgentExecutorFactoryDeps;
  private readonly cache = new Map<ExecutorId, AgentExecutor>();

  constructor(deps: DefaultAgentExecutorFactoryDeps = {}) {
    this.deps = deps;
  }

  create(selection: ExecutorSelection): AgentExecutor {
    const descriptor = getExecutorDescriptor(selection.executorId);
    if (!descriptor.enabled) {
      throw new Error(`Executor "${selection.executorId}" is disabled in this build.`);
    }

    const cached = this.cache.get(selection.executorId);
    if (cached !== undefined) {
      return cached;
    }

    const executor = this.build(selection.executorId);
    this.cache.set(selection.executorId, executor);
    return executor;
  }

  private build(executorId: ExecutorId): AgentExecutor {
    switch (executorId) {
      case GEMINI_EXECUTOR_ID:
        return new GeminiCliExecutor(this.deps.gemini);
      case CLAUDE_CODE_EXECUTOR_ID:
        return new ClaudeCodeCliExecutor(this.deps.claude);
      default:
        throw new Error(`Executor "${executorId}" is not implemented.`);
    }
  }
}

export class FixedAgentExecutorFactory implements AgentExecutorFactory {
  constructor(private readonly executor: AgentExecutor) {}

  create(_selection: ExecutorSelection): AgentExecutor {
    return this.executor;
  }
}
