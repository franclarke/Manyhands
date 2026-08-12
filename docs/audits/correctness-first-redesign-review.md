# Correctness-First Redesign Architecture Review

**Date:** 2026-08-12

**Normative output:**
[`../plans/2026-08-12-correctness-first-system-redesign.md`](../plans/2026-08-12-correctness-first-system-redesign.md)

**Status:** review complete; implementation not started by this review

## 1. Decision

The reviewed architecture is sufficiently solid to begin **Stage 0**.

This is not an implementation-readiness claim for later stages. Stage 0 exists
to freeze an attributable baseline, trace the productive route and create the
invariant transition ledger. No execution, durability, sandbox or delivery
claim becomes true merely because the design is now coherent.

The review accepted every critique at least in substance, but modified six of
them to avoid replacing one ambiguity with a larger abstraction. It also found
five foundation-level gaps not fully covered by the supplied critiques:

1. progressive planning needs immutable post-artifact Repository Views;
2. manifest content identity was mixed with mutable lifecycle/evidence;
3. single-writer events lacked a general durable physical-effect protocol;
4. semantic resources, runtime leases and soft scheduling risk were conflated;
5. the privileged browser/web/daemon boundary was underspecified.

## 2. Scope and method

The review distinguished three systems throughout:

- **Current implementation:** productive code and persisted behavior inspected
  in this repository.
- **Transitional implementation:** compatibility readers/adapters allowed only
  while a target owner is cut over and the old producer is retired.
- **Target architecture:** the normative design after this review.

The review read the complete prior redesign, `PRODUCT.md`, repository guidance,
productive planning/lifecycle/scheduler/artifact/integration/validation/store
and delivery paths, and current primary external references. Legacy tests were
treated as current-characterization evidence, not target authority.

The decision sequence was: reconstruct design intent; evaluate A-J; inspect
productive constraints; search for new failures; choose the smallest invariant-
bearing abstraction; rewrite the normative design; then run consistency,
complexity, failure-mode, model-failure and frontier-product passes.

## 3. Current implementation evidence

The current system already contains mechanisms worth preserving:

- exact-candidate validation and criterion/obligation evidence bindings in
  `packages/execution-core/src/validation/`;
- fenced/checksummed append-only run events with partial-tail recovery in
  `packages/run-store/src/jsonl-event-store.ts`;
- process evidence and operation-specific recovery;
- an integration operation journal that recognizes the crash window after a
  Git commit but before journal completion;
- delivery approval fingerprints, target head/cleanliness rechecks,
  fast-forward publication and receipts.

It also confirms the target gaps:

- run creation starts a web-owned background task
  (`apps/web/src/app/api/runs/route.ts:105`);
- a GET route performs projection/liveness reconciliation
  (`apps/web/src/app/api/runs/[id]/route.ts:17-19`);
- background ownership is process-local on `globalThis`
  (`apps/web/src/lib/server/runs/runner-state.ts:6-73`);
- productive planning projects the semantic plan through the legacy compiler
  representation twice
  (`apps/web/src/lib/server/runs/v2/planning-host.ts:170-184`);
- scheduling still mixes pair conflict evidence with blocking readiness
  (`packages/scheduler/src/wave-selector-v2.ts:1-65`);
- conflict risk uses hand-weighted scores
  (`packages/conflict-risk/src/index.ts:183-240`);
- the Claude execution profile can use `--dangerously-skip-permissions` and
  loads project/local settings, while the environment reducer forwards user
  profile paths and correctly documents that it is not a sandbox
  (`packages/execution-core/src/executor/profiles/claude-code.ts:7-28`,
  `packages/execution-core/src/executor/agent-env.ts:44-78`);
- artifact materialization accepts only commit artifacts and cherry-picks them
  (`packages/execution-core/src/base/artifact-materializer.ts:26-42`);
- integration is still commit/cherry-pick oriented, although its operation
  journal is a useful recovery precedent
  (`packages/execution-core/src/integration/agent.ts:340-500`);
- delivery already fails closed on changed/dirty targets and uses `--ff-only`
  (`apps/web/src/lib/server/runs/v2/command-host.ts:334-355`).

These are foundations or transition gaps, not proof that similarly named
target capabilities are complete.

## 4. Decision matrix

| Critique | Current design behavior | Actual risk | Evidence | Verdict | Architectural change? | Reason | Second-order effects |
|---|---|---|---|---|---|---|---|
| A — flat ResourceClaim | equality-like claims lacked cross-level identity and consumed version | aliases evade exclusion; read/write locks misdescribe isolated bases | package/file/schema counterexamples and string-key scheduler semantics | **ACCEPT WITH MODIFICATION** | view-scoped ResourceCatalog, tri-state overlap, versioned observe/modify claims; runtime leases separate | identity, authority, version and physical exclusion are different facts | unknown writes block; frozen readers may run with writers; readers of new output use ArtifactRequirement |
| B — safety differs from risk | replacing the pair matrix risked deleting useful selection policy | safe siblings can still have high integration cost | weighted all-pairs product and blocking use in `conflict-risk`/`wave-selector-v2` | **ACCEPT WITH MODIFICATION** | pure ReadinessEvaluator plus bounded SelectionPolicy and advisory IntegrationRiskEstimate | safety must be deterministic while cost/order may be heuristic | lazy/indexed estimates only; bad estimates cost time, not correctness; learned weights deferred |
| C — actor is not durable effects | single writer ordered decisions but not event/action crash windows | physical success can be lost or repeated | operation-specific process/integration/delivery recovery exists, but no general protocol | **ACCEPT** | canonical journal outbox; intent-before-effect, stable identity, immutable receipts, reconcile, crash gate | actor ordering and external atomicity are distinct | unavoidable per-kind adapters; promises one observed outcome, not exactly-once execution |
| D — ArtifactManifest mixes concepts | one shape mixed change sets, trees, interface semantics and evidence/lifecycle | identity mutates; undeclared ancestry can cross boundaries | commit-only cherry-pick materializer and post-production evidence lifecycle | **ACCEPT** | immutable `ChangeSetManifest \| CandidateTreeManifest`; semantic role in ArtifactContract; Evidence Matrix separate; Git ODB refs | physical transport and semantic/evidence records have different structure | no custom blob CAS; exact OIDs/modes add retention and Git-edge obligations |
| E — criteria need proof semantics | obligations existed but root criteria did not constrain proof authority | green build can falsely satisfy UX/external/observational claims | current criterion/obligation bindings are strong but Goal intake lacks authority policy | **ACCEPT WITH MODIFICATION** | Goal allowed mode/authority pairs; obligation selects ProofStrategy; evidence binds execution | requirement, allowed proof, concrete strategy and observation are separate | missing required oracle becomes `needs_input`; human-review UX becomes first-class |
| F — daemon trust boundary | daemon ownership had no precise privileged transport | malicious browser origin or leaked token can control process/repository mutation | proposed daemon powers plus absent transport/auth contract | **ACCEPT** | browser -> same-origin Next BFF -> restricted pipe/socket -> daemon; capability + nonce; opt-in strict loopback fallback | localhost is not authentication; full identity platform is unnecessary | platform IPC code required; same-user host compromise remains residual |
| G — model verifier authority | model critic existed without a complete authority table | nondeterministic criticism can approve/block correctness | probabilistic output has no stable invariant semantics | **ACCEPT** | deterministic validators may block; model findings lead to check/query/replan/human decision | model output can discover hypotheses, not establish truth | auto-progress may pause while a concern is checked; model never final authority |
| H — integration super-agent | parent integration ownership could be interpreted broadly | root repair erases attribution and hides child defects | current integration repair prompt/path can alter the combined worktree | **ACCEPT** | same scope enforcer for composites; only explicit parent resources | repair must occur at the lowest authoritative owner | more repair round trips, but preserved diagnosis and ownership |
| I — low confidence is not unknown | one scalar risked carrying evidence absence and quality | downstream code treats no evidence as weak evidence | uncertainty appears across repository, planning and validation decisions | **ACCEPT WITH MODIFICATION** | EpistemicAssessment separates unknown/known/partial/conflicting; confidence only with evidence | state and confidence are orthogonal | exhaustive handling cost prevents optimistic defaults; validation uses discrete outcomes |
| J — serialize double writers | scheduler order could compensate for overlapping exclusive claims | ambiguous ownership remains hidden and order-dependent | pair blocking can serialize without proving a dataflow relation | **ACCEPT WITH MODIFICATION** | unordered overlapping writers invalid; sequential transform requires artifact/resource version chain | order is correct only when it represents declared dataflow | some plans now reject earlier; scheduler cannot hide decomposition errors |

No critique was accepted merely because an external reviewer proposed it. No
critique was rejected in full because repository evidence and end-to-end
invariant analysis found a real failure behind each one.

The review did reject specific proposed forms: raw resource equality, a general
resource ontology, an all-pairs risk scorer, exactly-once effects, a separate
workflow database/platform, a custom blob CAS, browser-direct daemon access,
an unrestricted integration agent, serialization as a cure for duplicate
writers, and model judgement as final authority. Each either failed an
invariant, duplicated an existing substrate or added more failure surface than
the problem required.

## 5. Detailed decisions and alternatives

### A. Resource identity and versions

**Original issue:** raw keys cannot express aliasing or containment.

**Final decision:** Repository Model/View builds a ResourceCatalog with canonical
IDs, alias equivalence, containment and `overlaps(): yes | no | unknown`.
ResourceClaim carries authority and input/output version; the catalog does not.
Physical ports, refs and process slots are RuntimeLeaseClaims.

**Alternatives:** strict path normalization was too weak; a general semantic
ontology was too broad; pessimistically serializing every ambiguous pair would
hide ownership and destroy parallelism. Unknown modification overlap therefore
blocks approval/parallel readiness, while observed frozen-base readers can run
with an isolated writer.

### B. Hard readiness and soft risk

**Original issue:** “can run together” is not “should run together.”

**Final decision:** readiness is a deterministic obligation result. Selection
operates only on ready candidates and may use evidence-backed API proximity,
dependency neighborhood, integration hotspots, grounding uncertainty and
failures already seen in the run. It evaluates incrementally against a small
selected set, not every graph pair.

**Alternatives:** removing risk entirely loses an operational cost signal;
preserving the current all-pairs weighted product gives a heuristic safety
authority. Historical learning is deferred until an attributable calibration
dataset exists.

### C. Durable effects

**Original issue:** actor ordering does not atomically cover external mutation.

**Final decision:** `effect.requested` is the durable outbox record. Every
effect has stable input identity, reconciliation policy and actor-consumed
terminal fact. A receipt is physical evidence, never lifecycle authority.

**Alternatives:** exactly-once is false after ambiguous crashes; a separate
database/outbox creates two durable authorities; a general workflow platform is
unnecessary for a local product. Kind-specific adapters are unavoidable because
process identity, Git refs and delivery destinations reconcile differently.

### D. Artifacts and Git

**Original issue:** changes, complete trees and evidence have different
structure and custody.

**Final decision:** only change-set and candidate-tree manifests are physical
artifact variants initially. Interface snapshot is a semantic ArtifactContract
role over a change set. Evidence/logs/traces remain typed records. Git blob/tree
OIDs and modes are transport identity; commits are provenance; retained
namespaced refs prevent collection.

**Alternatives:** textual patches lose binary/mode/symlink fidelity; full commit
transport leaks undeclared changes; a custom CAS duplicates Git. Rename is
explanatory only because Git detection is heuristic; exact transport is
delete/add.

### E. Proof authority

**Original issue:** criteria did not constrain what may prove them.

**Final decision:** the GoalContract accepts a verification policy. Concrete
ProofStrategies are derived later from the exact Repository View. Evidence
binds strategy, verifier, environment and candidate. Required criteria without
allowed available proof stop at an explicit decision.

**Alternatives:** putting exact commands in intake is prematurely repository-
specific; inferring authority only during validation allows silent downgrade.
An LLM can supply advisory evidence but cannot be final correctness authority.

### F. Local security boundary

**Original issue:** a privileged localhost daemon was underspecified.

**Final decision:** browser JavaScript never receives daemon credentials. The
trusted local Next server applies same-origin/CSRF/Fetch-Metadata policy and
uses a current-user pipe/socket plus installation capability and command nonce.
Loopback TCP is dev-only opt-in with capability, strict Host/Origin and no broad
CORS.

**Alternatives:** a remote identity platform is unnecessary; a bare port is
unsafe; OS ACL alone does not replace command authentication. Same-user malware
is outside the product sandbox and remains documented.

### G-J. Authority, integration, epistemics and writers

Deterministic schema/repository/resource checks may block. External protected
oracles and candidate-bound human review may satisfy only declared policies.
Model critics cannot. Integration has explicit parent scope and routes repairs
to the lowest owner. Unknown is a separate epistemic state. Duplicate unordered
writers are invalid, while deliberate sequential transforms are explicit
artifact/version dataflow.

## 6. New problems found beyond A-J

### N1. Progressive planning over stale repository truth

The base RepositoryModel cannot be mutated without losing attribution, but later
planning may need newly adopted interfaces. Immutable RepositoryViews solve this
by overlaying exact artifact manifests and producing a new digest/catalog.

### N2. Mutable manifest identity

Putting status or evidence into a content manifest makes the same content change
identity when verified/adopted. Lifecycle and evidence are now journal facts
bound to an immutable manifest digest.

### N3. Duplicate persistence authority

Attempt/artifact/effect files can become hidden lifecycle state machines. The
review makes them immutable content, projections or physical receipts; only
canonical actor events advance the domain.

### N4. Cancellation lacked a physical invariant

Logical cancellation is false while an owned process can still mutate. The
target requires process-group termination, verified death, reconciled cleanup
and a recorded race disposition before terminal cancellation.

### N5. Git ODB reachability and execution configuration

Git-native artifacts disappear if objects are unreachable, and candidate
content can vary through hooks, filters, line endings, submodules or inherited
configuration. Retained run refs and an explicit Git execution policy are now
part of the artifact gate.

### N6. Circular proof and false-positive validation

Generated tests can validate themselves; wrong selectors and pre-existing
green tests can create false success. Root proof authority, baseline/negative
controls, selector attribution and no-op checks are explicit.

### N7. Artifact/dataflow cycles

A hierarchy can be acyclic while artifact/version dependencies form a cycle.
The verifier now checks executable dataflow separately and requires a frozen
contract-first seam or rejection.

### N8. Exact delivery needed ambiguous-outcome reconciliation

Current delivery has strong target checks and receipts but a crash after
fast-forward and before durable completion still requires destination
reconciliation. Delivery is now an effect with expected OID/CAS semantics.

## 7. Abstraction budget

| Problem | Failure mode | Why existing is insufficient | New abstraction | Invariant gained | Cost | Simpler alternative | Why rejected |
|---|---|---|---|---|---|---|---|
| evolving repository truth | stale progressive plan | immutable base alone cannot see adopted changes | RepositoryView | every decision names exact observed content | overlay/cache invalidation | mutate base model | destroys attribution |
| absent versus weak knowledge | unknown becomes optimistic low confidence | scalar confidence cannot encode provenance/absence/conflict | EpistemicAssessment | unknown/partial/conflicting require explicit handling | exhaustive state handling | add `unknown` to confidence enum | still conflates evidence state with confidence |
| cross-level resource identity | missed conflict | raw keys miss aliases/containment | ResourceCatalog | overlap is canonical or explicit unknown | indexing/coverage | normalized paths | cannot represent schema/module aliases |
| semantic vs physical exclusion | wrong serialization/authority | one claim type mixes code and host state | ResourceClaim + RuntimeLeaseClaim | ownership cannot be inferred from a port/ref lock | two small claim APIs | one universal lock | hides domain semantics |
| safe but expensive parallelism | high integration cost | claims express legality, not preference | IntegrationRiskEstimate | heuristic cannot affect correctness | signal calibration | no risk policy | loses useful operational choice |
| event/action crash window | duplicate/lost effect | actor serializes only durable state | EffectIntent + physical receipt | intent before mutation and reconcile before repeat | adapters/crash tests | retry command | unsafe after ambiguous success |
| executor process survives owner | duplicate or orphan mutation | effect identity alone cannot prove process death/PID reuse | supervisor wrapper + process identity | replacement starts only after terminal receipt or verified death | platform-specific supervision | store PID | PID is reusable and descendants escape |
| heterogeneous artifacts | accidental transport/mutable identity | one shape mixes content/evidence/status | Git-native manifest union | exact scoped immutable materialization | Git edge handling/retention | full commits | leaks undeclared changes |
| criterion proof downgrade | false green success | obligations alone do not constrain root authority | verification policy + ProofStrategy | required criteria cannot be silently reinterpreted | intake/UX complexity | infer from tests | tests do not prove all claims |
| privileged local control | browser-origin daemon control | localhost is not authentication | trusted BFF + restricted IPC | browser lacks daemon authority | platform IPC code | bare localhost token | token/origin exposure |

No new database server, remote queue, microservice, generic workflow engine,
custom blob CAS or pairwise graph product was added.

## 8. Complexity pass

The final design removes or schedules removal of:

- `SemanticPlan -> WorkBreakdown -> SemanticPlan` representation drift;
- pairwise conflict matrices as a graph/scheduler substrate;
- commit-as-artifact transport;
- manifest-embedded lifecycle/evidence;
- GET-triggered lifecycle reconciliation;
- web/globalThis process ownership;
- duplicate lifecycle authority in operation receipts;
- custom content storage already supplied by Git;
- universal integration repair authority;
- permanent compatibility producers and dual writes.

Complexity retained is tied to an observable corruption state: repository views,
resource overlap, proof authority, durable effects, scoped manifests, IPC and
platform process/sandbox adapters. Compatibility is read-boundary-only and each
adapter has a retirement stage.

## 9. Failure-mode coverage

| Scenario | Prevention / detection / recovery / decision |
|---|---|
| planner emits invalid architecture | deterministic plan verifier rejects before compilation |
| planner misses dependency | execution discovery records evidence; bounded local amendment/replan; no undeclared adoption |
| Repository Model is incomplete | epistemic unknown/partial propagates; write overlap fails closed or asks human |
| two agents indirectly interact | catalog/dependency risk influences selection; exact integration/validation detects semantic break |
| agent writes outside scope | Git diff scope enforcer rejects candidate; sandbox provides earlier prevention |
| agent creates commit | Git state is observed but never adopted; orchestrator rebuilds scoped candidate |
| agent modifies generated file | generated-file policy accepts explicitly or rejects; no silent transport |
| agent crashes or protocol is partial | supervisor receipt plus immutable interrupted attempt; classified retry |
| agent spawns descendants | sandbox/process group owns the tree; timeout/cancel/restart verifies all descendants dead |
| executor hangs | deadline, process-group termination, verified death, new attempt only afterward |
| agent reports success but diff is wrong | stdout is non-authoritative; Git manifest/scope and proof decide |
| path/command injection | normalized real paths, argument arrays and compiled command policy; fail closed |
| credential or network escape | brokered attempt identity, explicit sandbox network policy, redaction/secret scan |
| malicious Git config/hook/filter | controlled Git config disables executable inheritance and unsafe protocols |
| tests accidentally pass | criterion authority, baseline/negative control, selector and no-op checks |
| artifact applied twice | manifest/input digest and materialization identity make repeat detectable/idempotent |
| artifact base changed | preimage/base tree mismatch fails; explicit rebase/amendment decision |
| textual integration clean but semantically wrong | composite/root obligations validate exact combined candidate |
| repair changes unrelated files | same parent/child scope enforcer rejects repair candidate |
| crash before process spawn | pending intent reconciles as absent; dispatch under same effect identity |
| crash after process spawn | started receipt/process identity; adopt terminal receipt or prove tree dead before new attempt |
| crash during Git operation | effect-scoped index/ref and Git-state inspection; adopt exact tree or discard/quarantine |
| daemon starts twice | installation lock, PID/start identity, nonce and actor fencing reject takeover |
| web restarts/browser disappears | no execution authority in either; daemon continues |
| cancel during execution/integration | cancel command fences adoption, kills process group and reconciles cleanup |
| local human decision remains pending | decision scope blocks only affected readiness; unrelated work continues |
| machine restarts | journal tail repair, pending-effect reconciliation, process death/ref/sandbox inspection |
| delivery destination moved | immediate expected-OID/CAS check; fail closed at explicit decision |
| crash after physical delivery | reconcile target ref/tree, synthesize only matching receipt, never publish twice over divergence |
| duplicate command/effect receipt | stable IDs plus content digest; same content is idempotent, different content is corruption |
| incomplete journal tail | checksum/sequence validation and truncate only incomplete final record |
| corrupt complete/middle journal record | fail closed with operator diagnostic; never guess history |
| evidence belongs to another candidate | subject digest mismatch rejects binding/adoption/delivery |

Every listed failure has a prevention, detection, deterministic recovery or
explicit decision. None relies on the model remembering a rule or reporting
honestly.

## 10. Frontier comparison

- [Codex subagents](https://developers.openai.com/codex/subagents) support the
  value of specialized parallel contexts but explicitly make concurrent-write
  coordination and token cost product concerns. ManyHands adds stronger typed
  ownership/evidence because its unit is an integrated delivered run.
- [Codex worktrees](https://developers.openai.com/codex/app/worktrees) provide
  independent checkouts while sharing Git metadata. This supports the design's
  separation between checkout isolation, resource authority and security
  sandboxing.
- [Anthropic's multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)
  reports benefits for breadth-first independent work and substantial token
  overhead, with less natural parallelism in coding. ManyHands therefore does
  not optimize fan-out and requires end-state product oracles.
- [Claude Code's CLI reference](https://code.claude.com/docs/en/cli-usage)
  exposes structured streaming, turn/budget limits, permission modes and a
  provider background-session supervisor. ManyHands can consume those adapter
  capabilities and receipts, but cannot delegate run lifecycle authority to a
  provider-specific daemon.
- [Claude Code security guidance](https://code.claude.com/docs/en/security)
  distinguishes permissions, filesystem/network sandboxing, scoped credentials
  and VM-level isolation. It also makes non-interactive trust behavior relevant;
  ManyHands must verify the effective profile instead of assuming it.
- [OpenHands runtimes](https://docs.openhands.dev/openhands/usage/architecture/runtime)
  treat the execution environment as an explicit security/reproducibility
  boundary. ManyHands follows that separation without adopting a remote service
  architecture.
- [SWE-agent's ACI](https://swe-agent.com/latest/background/aci/) reinforces
  bounded inspectable tool interfaces. ManyHands additionally derives truth
  from Git and independent evidence rather than model output.
- [OpenAI Symphony](https://github.com/openai/symphony/blob/main/SPEC.md)
  illustrates local workspace containment, restart-oriented reconciliation and
  single task ownership. ManyHands needs a stronger durable effect and
  hierarchical integration protocol because it claims exact multi-agent
  delivery.
- [Temporal's Activity model](https://docs.temporal.io/activity-definition)
  makes the unavoidable point that external activities can execute more than
  once after a crash. ManyHands adopts idempotency/reconciliation semantics, not
  Temporal's server/platform complexity.
- Git's [`update-ref`](https://git-scm.com/docs/git-update-ref) and
  [`diff-tree`](https://git-scm.com/docs/git-diff-tree) supply the primitive
  object/mode and compare-and-swap behavior needed without a custom CAS.

The review copied no framework architecture wholesale. It retained only lessons
that close a ManyHands failure mode.

## 11. Consistency pass result

The normative document now aligns:

- Goal verification policy -> concrete ProofStrategy -> exact EvidenceBinding;
- Repository View -> ResourceCatalog -> versioned ResourceClaim -> hard
  readiness;
- SemanticPlan -> deterministic verification -> direct GraphRevision;
- durable effect intent -> physical receipt/reconciliation -> actor event;
- immutable attempt -> Git-observed scoped manifest -> exact candidate proof;
- child artifacts -> scoped composite attempt -> root evidence;
- approved exact tree -> expected target OID/CAS -> delivery receipt;
- daemon mutation ownership -> read-only web/API queries.

Stage dependencies now introduce the daemon/effect kernel before productive
lifecycle cutover, repository views before live planning, offline planner gates
before its cutover, scoped artifacts before live executors, one live leaf before
parallel integration, and crash-safe delivery before product qualification.
Every temporary compatibility path has an explicit retirement stage.

## 12. Residual risks after the redesign

The design cannot eliminate:

- semantic planning mistakes when evidence is incomplete;
- absent executable oracles for subjective/external requirements;
- probabilistic model quality and repair cost;
- host compromise by another process under the same OS user;
- platform variance in Windows/Unix sandbox and process guarantees;
- Git/config/submodule edge behavior until real platform tests pass;
- lost parallelism or extra human clarification while resource overlap remains
  unknown;
- performance/cost of immutable views, validation and reconciliation;
- soft-risk miscalibration (correctness is insulated, throughput is not);
- human review latency and judgment error.

These are explicit limitations or assigned gate experiments. None authorizes
silent success.

## 13. Stage 0 authorization

**Conclusion: YES — begin Stage 0.**

The foundations are coherent enough to record the baseline and transition
ledger. Do not begin Stage 1 until G0 exists on an exact candidate. Do not infer
that the daemon, effect protocol, Git-native artifacts, sandbox or product gates
are implemented. The next task should execute the authoritative stages in order,
starting with evidence collection and no legacy behavior changes.
