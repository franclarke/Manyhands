"use client";

import type { InspectorView } from "@/lib/graph-view-model";
import {
  Card,
  Checklist,
  EmptyHint,
  InterfaceList,
  KvGrid,
  LinkedNodeList,
  MonoList,
  Prose,
  Section,
  SnippetList,
  Tag
} from "./task-inspector-ui";

export function ContractTab({ view }: { view: InspectorView }): React.ReactElement {
  if (view.contract === undefined) {
    return <EmptyHint>This composite node has no leaf contract. Inspect a leaf child for scope rules.</EmptyHint>;
  }

  const contract = view.contract;
  const executionScope = contract.executionScope;
  const allValidationCommands = [
    ...contract.validationCommands.map((command) => ({
      label: command.kind,
      command: command.command ?? command.kind,
      args: [] as string[],
      timeoutMs: command.timeoutMs,
      cwd: undefined as "worktree" | "repo-root" | undefined,
      blocking: command.blocking
    })),
    ...(contract.leafValidationCommands ?? []).map((command) => ({ label: "leaf", ...command, blocking: true })),
    ...(contract.parentValidationCommands ?? []).map((command) => ({ label: "parent", ...command, blocking: true })),
    ...(contract.runValidationCommands ?? []).map((command) => ({ label: "run", ...command, blocking: true }))
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Section title="Contract readiness">
        <ContractCompleteness contract={contract} />
      </Section>
      <Section title="Mission">
        <Card>
          <Prose>{contract.objective}</Prose>
          <div style={{ height: 10 }} />
          <div className="mh-coord" style={{ color: "var(--text-3)", marginBottom: 5 }}>
            definition of done
          </div>
          <Prose>{contract.definitionOfDone}</Prose>
        </Card>
      </Section>
      <Section title="Scope">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Card>
            <div className="mh-coord" style={{ color: "var(--text-3)", marginBottom: 6 }}>
              allowed paths
            </div>
            <MonoList items={contract.allowedPaths} empty="none declared" />
          </Card>
          <Card>
            <div className="mh-coord" style={{ color: "var(--text-3)", marginBottom: 6 }}>
              forbidden paths
            </div>
            <MonoList
              items={[...contract.forbiddenPaths, ...(contract.explicitForbiddenPaths ?? [])]}
              empty="none declared"
            />
          </Card>
          {executionScope !== undefined ? (
            <Card>
              <div className="mh-coord" style={{ color: "var(--text-3)", marginBottom: 6 }}>
                execution scope
              </div>
              <ScopedPathGroup label="implementation" items={executionScope.implementationPaths} />
              <ScopedPathGroup label="tests" items={executionScope.testPaths} />
              <ScopedPathGroup label="config" items={executionScope.configPaths} />
            </Card>
          ) : null}
        </div>
      </Section>
      <Section title="Acceptance">
        <Checklist items={contract.acceptanceCriteria} empty="none declared" />
        <div style={{ height: 10 }} />
        <CommandList commands={allValidationCommands} />
      </Section>
      <Section title="Context">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Card>
            <div className="mh-coord" style={{ color: "var(--text-3)", marginBottom: 6 }}>
              relevant symbols
            </div>
            <MonoList items={contract.relevantSymbols} empty="none declared" />
          </Card>
          <Card>
            <div className="mh-coord" style={{ color: "var(--text-3)", marginBottom: 6 }}>
              conventions
            </div>
            <MonoList items={contract.context.conventions} empty="none declared" />
          </Card>
          <Card>
            <div className="mh-coord" style={{ color: "var(--text-3)", marginBottom: 6 }}>
              upstream artifacts
            </div>
            <MonoList items={contract.context.upstreamArtifacts} empty="none declared" />
          </Card>
          <SnippetList snippets={contract.context.referenceSnippets} />
          <MonoList items={contract.context.typeSignatures} empty="No type signatures declared." />
        </div>
      </Section>
      <Section title="Interfaces">
        <InterfaceList title="consumes" items={contract.consumedInterfaces} />
        <div style={{ height: 10 }} />
        <InterfaceList title="produces" items={contract.producedInterfaces} />
      </Section>
      <Section title="Expected output">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Card>
            <div className="mh-coord" style={{ color: "var(--text-3)", marginBottom: 6 }}>
              changed files
            </div>
            <MonoList items={contract.expectedFiles} empty="none declared" />
          </Card>
          <Card>
            <div className="mh-coord" style={{ color: "var(--text-3)", marginBottom: 6 }}>
              produced symbols
            </div>
            <MonoList items={contract.producedSymbols} empty="none declared" />
          </Card>
          <Card>
            <div className="mh-coord" style={{ color: "var(--text-3)", marginBottom: 6 }}>
              consumed symbols
            </div>
            <MonoList items={contract.consumedSymbols} empty="none declared" />
          </Card>
        </div>
      </Section>
      <Section title="Dependencies">
        <LinkedNodeList items={contract.dependencies} empty="none declared" />
      </Section>
      <Section title="Limits">
        <KvGrid
          rows={[
            { label: "Max duration", value: `${contract.maxDurationMs}ms`, mono: true },
            { label: "Max cost", value: `$${contract.maxCostUsd.toFixed(4)}`, mono: true },
            { label: "Known risks", value: String(contract.knownRisks.length), mono: true }
          ]}
        />
      </Section>
    </div>
  );
}

function ContractCompleteness({
  contract
}: {
  contract: NonNullable<InspectorView["contract"]>;
}): React.ReactElement {
  const checks = [
    { label: "objective", ready: contract.objective.trim().length > 0 },
    { label: "scope", ready: contract.allowedPaths.length > 0 || contract.executionScope !== undefined },
    { label: "acceptance", ready: contract.acceptanceCriteria.length > 0 },
    {
      label: "validation",
      ready:
        contract.validationCommands.length > 0 ||
        (contract.leafValidationCommands?.length ?? 0) > 0 ||
        (contract.parentValidationCommands?.length ?? 0) > 0 ||
        (contract.runValidationCommands?.length ?? 0) > 0
    },
    { label: "expected output", ready: contract.expectedFiles.length > 0 }
  ];

  return (
    <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
      {checks.map((check) => (
        <Tag key={check.label} tone={check.ready ? "accent" : "warning"}>
          {check.ready ? "set" : "missing"} {check.label}
        </Tag>
      ))}
    </div>
  );
}

function ScopedPathGroup({ label, items }: { label: string; items: string[] }): React.ReactElement {
  return (
    <div style={{ padding: "6px 0", borderTop: "1px solid var(--rule-soft)" }}>
      <div className="mh-coord" style={{ color: "var(--text-3)", marginBottom: 4 }}>
        {label}
      </div>
      <MonoList items={items} empty="none declared" />
    </div>
  );
}

function CommandList({
  commands
}: {
  commands: Array<{
    label: string;
    command: string;
    args: string[];
    timeoutMs?: number | undefined;
    cwd?: "worktree" | "repo-root" | undefined;
    blocking: boolean;
  }>;
}): React.ReactElement {
  if (commands.length === 0) {
    return <EmptyHint>No validation commands declared.</EmptyHint>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {commands.map((command, idx) => (
        <Card key={`${command.label}-${idx}`}>
          <div style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap", marginBottom: 5 }}>
            <Tag tone={command.blocking ? "accent" : "default"}>{command.label}</Tag>
            {command.cwd !== undefined ? <Tag>{command.cwd}</Tag> : null}
            {command.timeoutMs !== undefined ? <Tag>{command.timeoutMs}ms</Tag> : null}
          </div>
          <div className="mh-mono" style={{ color: "var(--text-2)", fontSize: 11.5, lineHeight: 1.5, wordBreak: "break-word" }}>
            {[command.command, ...command.args].join(" ")}
          </div>
        </Card>
      ))}
    </div>
  );
}
