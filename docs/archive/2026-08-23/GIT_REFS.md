# Referencias Git de recuperación

Inventario de refs creadas durante la consolidación del 2026-08-23. Las refs
preservan acceso a commits que podían perderse al retirar worktrees, reflogs y
objetos locales. **No prueban que su contenido sea correcto, integrado, seguro
o válido para una afirmación académica.** La recuperabilidad remota debe
comprobarse con `git ls-remote` después de publicarlas.

## Branches `archive/local/*`

| Ref | Commit |
|---|---|
| `archive/local/policy-guided-454cc334` | `454cc33404571a6ed42ac4c0071989138a4575b4` |
| `archive/local/reliability-a60caeec` | `a60caeec8b6d5cf34d40de62cab2e714f64e2f43` |
| `archive/local/semantic-c37d11f` | `c37d11f667856670d748cf796d6250812d3bfaba` |
| `archive/local/thesis-closure-0c05dbf` | `0c05dbf0feaec6870b5f285ac0e9a8d60bb59958` |
| `archive/local/ticket06-851e5f80` | `851e5f80db69ea6631dc3f103e4fc46125283afe` |
| `archive/local/ticket08-2f5a7a33` | `2f5a7a331215e01844365e93261017adeeade1b0` |

## Tags `archive/reflog/*`

| Ref | Commit |
|---|---|
| `archive/reflog/20260712-b024-a-92a7ca40` | `92a7ca40967144e31e45d0bbf630b19db24ff5b0` |
| `archive/reflog/20260712-b024-b-b52ae9a1` | `b52ae9a13200562e885b9da0fc1f86b7385dce58` |
| `archive/reflog/20260721-imgbot-444e74e6` | `444e74e6a14b2132a77d5b0a7e6eb0ca3a32f2cd` |
| `archive/reflog/20260723-imgbot-cc9b8744` | `cc9b874481b99e3acf6e0810f26b7b62a650d4cb` |
| `archive/reflog/20260724-scope-creation-933f828e` | `933f828e1f2a7206a6f44cb9054a67bb63a8436c` |
| `archive/reflog/20260728-closure-goal-a-50b36641` | `50b366419e56e0d460a4d883725210f981455c8c` |
| `archive/reflog/20260728-closure-goal-b-3c83650b` | `3c83650b0576ab0b499769096f1ed87d0d3a0503` |
| `archive/reflog/20260802-bounded-candidates-a-db8391d8` | `db8391d857dd48bd48e90754fc2942ab855928e6` |
| `archive/reflog/20260802-bounded-candidates-b-5d567e99` | `5d567e998e79266a883d3e5c5eefea3c4e438972` |
| `archive/reflog/20260808-public-surface-a-b063ab35` | `b063ab350fa8d7c70f7db25132e956a19e4c8e63` |
| `archive/reflog/20260808-public-surface-b-344e1734` | `344e173483489b015f655a33c578e93e9a68fac5` |
| `archive/reflog/20260812-redesign-baseline-111ef9a1` | `111ef9a17adc3bed7dc41dace090486963d7b847` |
| `archive/reflog/20260812-windows-supervision-b6b8df7e` | `b6b8df7e461cfe42e1bd517cfca0dbe0ecf89823` |
| `archive/reflog/20260813-canonical-graph-6fa5d3fa` | `6fa5d3fa12025e37ddde30f20dd7561f05a92f6c` |
| `archive/reflog/20260813-imgbot-48b8e182` | `48b8e182b0a33e722fc7b8318c7969f97d0ecd03` |
| `archive/reflog/20260813-stage6-gate-4afb0085` | `4afb00857a10f944f6bb0b1d809fb601453d9f44` |
| `archive/reflog/20260814-stage9-exact-artifacts-21061c77` | `21061c77a8ea8b403b448363e0868206ee587396` |
| `archive/reflog/20260814-stage9-lowest-repair-253c2d5a` | `253c2d5a43a6cc730c7c24ffa2e3020ec245863a` |
| `archive/reflog/20260815-daemon-startup-d0195516` | `d019551627163024a2a27f83ee16635eb10990a9` |

## Tags `archive/unreachable/*`

| Ref | Commit |
|---|---|
| `archive/unreachable/04e8cb6d` | `04e8cb6d7e72de5cfa4128c6cbc67835fe9f306c` |
| `archive/unreachable/2115cf8a` | `2115cf8aeec27479ac764c085526b109ed8c4024` |
| `archive/unreachable/42db58e6` | `42db58e6484af09ad6eaf6485edc04a09c1d910a` |
| `archive/unreachable/5e83af58` | `5e83af587c08614cde64ab2d32f45d4bfb7d80b6` |
| `archive/unreachable/7e1e0b7d` | `7e1e0b7d9e9c359dec6eb6b6a2fb0a84fab5dbb1` |
| `archive/unreachable/86268090` | `86268090ef398de02d906567f818e8cf70950bd0` |
| `archive/unreachable/e4cf7d04` | `e4cf7d04bc53c18620011743f5a997cb5f9adf24` |
| `archive/unreachable/f36f1273` | `f36f1273bfd632a71e379ae3e2292f70579fce20` |
| `archive/unreachable/f6545549` | `f6545549a1034b3d3523bb065d86f1097d7f6830` |
| `archive/unreachable/febcbf83` | `febcbf8355668b6708130af6e05e63d425db3392` |

## Rama Experimento

El tip `a3c378b4bf051597d60ce9c99cb9c3f5a0a063eb` de `Experimento` se
integrará en `main` en vez de conservarse únicamente como una branch archival.
Su incorporación debe verificarse por ancestry y por la identidad final de
`main` publicada en el snapshot de fuente.
