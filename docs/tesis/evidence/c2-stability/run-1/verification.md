# Verificación externa — run 1

- Run: `820d370e-b6fd-4f6e-bcd6-5c809494dd02`
- Base declarada y observada: `1da878de6edd38cefb1ea4d8ceecdceea0bb6acc`
- Commit entregado: `f86c5c71ddfec064b53f4473477d7bdd8099ad42`
- Clon limpio: `C:\Users\franc\AppData\Local\Temp\manyhands-c2-stability-verify-1`
- `pnpm install --frozen-lockfile`: PASS
- `pnpm test`: PASS, 9 tests
- `pnpm typecheck`: PASS
- Hash Git de `pnpm-lock.yaml` en worktree y `HEAD`:
  `71e29cbcee825867706cb174045aa2840f6fe7f0` en ambos casos

La verificación se ejecutó sobre el commit exacto, no sobre el target adoptado
ni sobre un fixture. El receipt persistido tiene `confirmed: true` y la matriz
de evidencia del run registra cinco criterios `satisfied`.
