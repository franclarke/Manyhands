# Validation stub and command surface

Clasificación: **defecto productivo de planning, scope y validación**.

## Observación

El run W1 `dbd343bd-3f65-4a51-90e0-742b5806c789` terminó con lifecycle
`completed`, matriz verificada y entrega
`651948b03cccb884ee41cbe4f20d4f43d290bfe1`. El oráculo externo falló al
invocar `pnpm study:probe`: la entrega no tenía ese script.

El snapshot prueba simultáneamente que:

- el repositorio exponía `test`, `typecheck` y `build` como stubs con
  `console.log`;
- el planner declaró que esos comandos debían validar el producto y que la
  sonda debía ser accesible mediante un package script;
- `plannedPaths` omitió `package.json`;
- el contrato estricto sólo permitió los archivos fuente y `tsconfig.json`.

La entrega conservó intactos los tres stubs. Por eso la validación interna
reportó PASS sin ejecutar los tests productivos agregados por el agente. El
oráculo externo actuó como falsador y la entrega no se adoptó para W2.

## Causa

La inspección conocía el manifest y sus scripts, pero no producía evidencia de
ruta para `package.json`. El prompt del planner tampoco exigía citar esa ruta al
cambiar la superficie de comandos. El compiler no podía ampliar scope sin una
ruta grounded y la aceptación del breakdown no rechazaba la contradicción entre
scripts stub y nuevas fuentes.

## Corrección TDD

- Rojo: regresiones reprodujeron la ausencia de evidencia `package.json`, la
  omisión de scope y la aceptación del breakdown incoherente.
- Verde: planning publica la ruta grounded del manifest; el planner debe citarla
  para scripts, dependencias y comandos; compiler y critic la reconocen; y el
  breakdown se reintenta si introduce fuentes mientras conserva comandos stub
  sin ninguna unidad que cite `package.json`.
- Verificación focal: 30 tests de planning/compiler PASS; typecheck de
  `@manyhands/decomposer` y web PASS.

No se relajó scope estricto ni se agregó una excepción Warehouse. La regla usa
capacidades inspeccionadas del repositorio y protege cualquier tarea que deba
reemplazar una superficie de validación ficticia.
