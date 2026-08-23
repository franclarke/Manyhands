# Repositorios target históricos

Durante el inventario previo a la limpieza aparecieron nueve repositorios Git
independientes fuera del object database de ManyHands. No definen la
arquitectura actual ni cierran gates: son targets históricos de QA y tesis que
permiten reconstruir ensayos tempranos de descomposición, integración y
estabilidad, además de las calificaciones productivas de Stage 8.

## Bundles preservados

| Bundle | Origen local histórico | Base `HEAD` | Tree | Commits | Refs | Bytes | SHA-256 |
|---|---|---|---|---:|---:|---:|---|
| `git/qa-throwaway-1.bundle` | `C:/Users/franc/manyhands-qa-throwaway` | `3be5806f823afa0b930bfd5e74517be733771881` | `217069bee850c7e361a87815e72b95ae0233ce7d` | 8 | 11 | 5314 | `a907e5068999d2910c27151e98e44788a1a55791c3924a9bab02b1e4471038d7` |
| `git/qa-throwaway-2.bundle` | `C:/Users/franc/manyhands-qa-throwaway2` | `ed0fadfba4b200e7ef6d067e78e96429ed66b223` | `3fc7a95ccb3407a59f92ba41c1b7aea766342e75` | 15 | 15 | 8813 | `f9cc2e1a591f02765013f0b0166282bdf95225f2967166d58dc8a66d36af950c` |
| `git/qa-throwaway-3.bundle` | `C:/Users/franc/manyhands-qa-throwaway3` | `9be19c87c90e8150b52ae16e2cb82abb2066306f` | `7978343569a534ab140e0b90f825848afe840946` | 14 | 21 | 13029 | `72a473748fb45ef19d2030cead9359e734fa754d394ba243c7cf6db0fb60ee67` |
| `git/expense-splitter.bundle` | `C:/Users/franc/manyhands-thesis-targets/expense-splitter` | `01a1f640c089f9e122f99e7ff2c54eda48427255` | `27da9e75d318df57268274ad4e0fda929d985baa` | 72 | 82 | 91864 | `4c40aa86583576bf508e81c5f5f19aaea13fbf57d1587ae0df13f77354419118` |
| `git/c2-stability-1.bundle` | `C:/Users/franc/manyhands-thesis-targets/c2-stability-1` | `f86c5c71ddfec064b53f4473477d7bdd8099ad42` | `8391ebfcf8ee8aefacc8673e085d74942a545082` | 31 | 29 | 53630 | `6e68826c9ec7dd597c69ed3e1488a0038ff1a3a70a1560e3754bea9925055eac` |
| `git/c2-stability-2.bundle` | `C:/Users/franc/manyhands-thesis-targets/c2-stability-2` | `cf0810b535f8ba4bfd43b8081640a5fa28aed4ad` | `37b771fa2202825e41bf32f5dfb8c8b4d9432272` | 31 | 29 | 53695 | `b551a531fcbbc1425fba8ab4c13c7c4af46a37acadb134f0e102820ac80bbca1` |
| `git/mh8-r0-sandbox.bundle` | `C:/Users/franc/Documents/mh8-r0-sandbox` | `603e5b9a9c3398135fc3a16123884a829e35da21` | `4d86e71ee4c88f1c5d0f6b4a8304739c7648790c` | 56 | 95 | 32391 | `3891763995ba8e1cdc2f2794655ad74507197b4f2cb88910485c0ec0d28482c6` |
| `git/stage8-live-target-4.bundle` | `C:/mh-exp/stage8-a006-live-target-4` | `603e5b9a9c3398135fc3a16123884a829e35da21` | `4d86e71ee4c88f1c5d0f6b4a8304739c7648790c` | 13 | 15 | 10338 | `75a952ce2f04bb5197aacdd194cbaea5fd121672ad3fcbcd5852a8404d7c9846` |
| `git/codex-sandbox-probe.bundle` | `C:/mh-exp/codex-sandbox-probe` | `d2053627848c63aca1d597e6f31ec55652139d0b` | `4b825dc642cb6eb9a060e54bf8d69288fbee4904` | 1 | 2 | 291 | `6ec520f27fd3e503c1682045ce56d49b716e166c558350abde84d2d238e07d5f` |

Los nueve bundles pasaron `git bundle verify`. La auditoría recorrió 241 visitas
a commits alcanzables, equivalentes a 169 commits únicos después de descontar
la historia compartida y de fijar los worktree heads y objetos recuperables: no
encontró patrones de secretos de alta confianza, nombres sensibles ni blobs
mayores a 10 MB.

## Estado de worktrees preservado

Cuatro worktrees QA contenían archivos de producto o locks generados sin commit.
Los archivos de producto se fijaron antes de crear los bundles:

- QA 1, root: `7e0f95111c6643ee2af2debd00bc444b5218a6f5`.
- QA 2, root: `f6228ef826a3231c08fc5cc8d9d12c7cf789599e`.
- QA 3, event-bus-test: `40225edb9e637fccdd45b3a3eb48fd329272283b`.
- QA 3, store-memory-test: `e521eaeb6cd76bdeafed5908ec395f125f8f95e5`.

Los detached worktree heads de los targets de tesis quedaron bajo tags
`archive/worktree/*`. También se fijaron los commits recuperables que `git fsck
--no-reflogs --unreachable` encontró en QA 3 y expense-splitter bajo
`archive/unreachable/*`.

El sandbox de Stage 8 conservaba 22 commits materializados y dos blobs de fuente
sin refs; ahora están bajo `refs/archive/unreachable/*` dentro de su bundle. El
target 4 agrega el candidate commit único
`ae4af880a289442df9fc2993c4f257c9230502c8`. El probe de sandbox se preserva
como control negativo de tree vacío, no como resultado del producto.

Se excluyeron `node_modules`, caches, locks y materializaciones duplicadas de
worktrees. No eran evidencia canónica; sus commits, ramas y heads sí están en
los bundles. Los tres índices JSON de `.manyhands/cache` del sandbox de Stage 8
eran derivados regenerables de commits ya preservados y también se excluyeron.
El detalle estructurado está en [`manifest.json`](manifest.json).

## Restauración

```bash
git bundle verify git/expense-splitter.bundle
git clone git/expense-splitter.bundle restored-expense-splitter
git -C restored-expense-splitter fsck --full
```

Para inspeccionar todos los puntos de entrada de un bundle:

```bash
git bundle list-heads git/qa-throwaway-3.bundle
```
