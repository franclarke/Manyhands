# Benchmark Configurations

Lab Mode note: these configurations are evaluation strategies for the deterministic laboratory. They do not define the whole ManyHands product, whose next direction is the visual web orchestration workspace described in `product-vision.md`.

Phase 7 compares four deterministic mock configurations.

## B0 - single_task_mock

`B0` is a structural single-task baseline. It uses `SingleTaskDecomposer`, produces one leaf task and schedules one batch.

It is not a real single-agent result. It exists to estimate the visible coordination surface of a monolithic task.

## B1 - decomposed_sequential

`B1` uses `MetadataDrivenMockDecomposer` with balanced decomposition and `sequential_dag` scheduling.

It preserves task decomposition while intentionally avoiding parallelism.

## B2 - decomposed_parallel_naive

`B2` uses balanced decomposition and `parallel_naive` scheduling.

It schedules all ready tasks up to `maxParallel` and ignores conflict risk when forming batches.

## B3 - decomposed_risk_aware

`B3` uses balanced decomposition, repository indexing, static conflict signals v0 and `risk_aware` scheduling.

It represents the most complete mock ManyHands configuration currently available.

## B4 - human_gated_mock

`B4` uses balanced decomposition, repository index, static signals, `risk_aware` scheduling and deterministic mock human gate decisions.

It is not real human review. The gate serializes high-risk work and serializes blocking work after simulated review.
