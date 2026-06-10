import { CliAgentExecutor, type CliExecutorDeps, type CliExecutorProfile } from "./cli-executor";
import { CLAUDE_CODE_PROFILE } from "./profiles/claude-code";
import { CODEX_PROFILE } from "./profiles/codex";
import { GEMINI_PROFILE } from "./profiles/gemini";
import { getExecutorDescriptor, type ExecutorId, type ExecutorSelection } from "./registry";
import type { AgentExecutor } from "./types";

export interface AgentExecutorFactory {
  create(selection: ExecutorSelection): AgentExecutor;
}

/**
 * Profile registry: the data that makes the factory generic. Adding a CLI is a
 * profile + a registry descriptor — never a code change in the factory itself.
 */
const CLI_PROFILES: ReadonlyMap<ExecutorId, CliExecutorProfile> = new Map(
  [GEMINI_PROFILE, CLAUDE_CODE_PROFILE, CODEX_PROFILE].map((profile) => [profile.id, profile])
);

/** Per-executor dependency overrides (binary path, injected spawn for tests). */
export type DefaultAgentExecutorFactoryDeps = Partial<Record<ExecutorId, CliExecutorDeps>>;

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

    const profile = CLI_PROFILES.get(selection.executorId);
    if (profile === undefined) {
      throw new Error(`Executor "${selection.executorId}" has no CLI profile implemented.`);
    }

    const executor = new CliAgentExecutor(profile, this.deps[selection.executorId] ?? {});
    this.cache.set(selection.executorId, executor);
    return executor;
  }
}

export class FixedAgentExecutorFactory implements AgentExecutorFactory {
  constructor(private readonly executor: AgentExecutor) {}

  create(_selection: ExecutorSelection): AgentExecutor {
    return this.executor;
  }
}
