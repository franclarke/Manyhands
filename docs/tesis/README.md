# Trabajo final de Ingeniería en Sistemas de Información — Tesis de ManyHands

> **Historical draft — not current evidence.** This directory reflects an
> earlier architecture and experimental series. The evidence paths described
> below are not present in the current tree, and the historical `4/4` result
> must not be used to close any current architecture gate. Preserve these claims
> as historical material until a new post-`GProd` study replaces them with
> attributable candidate, oracle and delivery evidence.

Documento de tesis en **LaTeX** para el **Departamento de Ciencias e Ingeniería
de la Computación (DCIC)** de la **Universidad Nacional del Sur (UNS)**.

---

## Datos del trabajo final

- **Título**: *Orquestación de agentes de lenguaje para el desarrollo de software: una política de descomposición adaptativa con verificación basada en evidencia*
- **Alumno**: Francisco Clarke (LU: 120547)
- **Carrera**: Ingeniería en Sistemas de Información
- **Directores**: Dra. Ana Gabriela Maguitman (Directora), Dr. Federico Martín Schmidt (Codirector)
- **Institución**: Universidad Nacional del Sur (UNS), Bahía Blanca, Argentina

---

## Compilación

Requiere una distribución TeX con `pdflatex` y `bibtex` (MiKTeX en Windows, TeX
Live en Linux/macOS). En MiKTeX conviene habilitar la instalación automática de
paquetes antes de la primera compilación:

```bash
initexmf --set-config-value="[MPM]AutoInstall=1"
```

Cuatro pasadas, para resolver índice, referencias cruzadas y bibliografía:

```bash
pdflatex --enable-installer -interaction=nonstopmode main.tex && bibtex main && pdflatex --enable-installer -interaction=nonstopmode main.tex && pdflatex --enable-installer -interaction=nonstopmode main.tex
```

El resultado es `main.pdf`. Los archivos auxiliares (`.aux`, `.out`, `.toc`,
`.bbl`, …) y el propio PDF **no se versionan**: son productos de compilación.

> **Si una compilación previa se interrumpió**, borrá los auxiliares antes de
> reintentar. Un `main.out` truncado hace que `hyperref` falle con
> `File ended while scanning use of \@@BOOKMARK`, un error que no señala la
> causa real.

Estado de la última compilación verificada: **45 páginas, sin referencias ni
citas indefinidas y sin cajas desbordadas.** El PDF incluye tres capturas del
run demostrativo y fue revisado visualmente después de renderizar sus páginas.

---

## Estructura del documento

Preliminares: carátula UNS, resumen y abstract, índices general, de figuras y
de tablas.

| Cap. | Título | Contenido |
|---|---|---|
| 1 | Introducción | Motivación, la paradoja de la granularidad, objetivos, preguntas de investigación, alcance y limitaciones |
| 2 | Conceptos preliminares | Agentes de código basados en modelos de lenguaje, grafos dirigidos acíclicos de tareas, aislamiento por worktrees de Git, verificación basada en evidencia, eventos de dominio como historia canónica |
| 3 | Estado del arte | Agentes autónomos en ingeniería de software, orquestación mediante grafos, políticas de costo y asignación de recursos, posicionamiento |
| 4 | Descomposición adaptativa | Formalización de $C_{task}$, frontera entre juicio semántico y decisión determinista, críticos de granularidad, **el resultado negativo: la política no puede inventar el corte**, pipeline resultante |
| 5 | Arquitectura | El run como unidad de producto, grafo de tareas y relaciones tipadas, contratos, eventos de dominio y proyecciones |
| 6 | Implementación | Organización del código, grounding del repositorio, planificación, planificación de olas, ejecución aislada, validación e integración, entrega, persistencia y recuperación, interfaz de supervisión |
| 7 | Evaluación | H-F1/H-F2, protocolo V2, freeze, preflight, 4/4 celdas, demostración visual y evidencia histórica retirada del argumento central |
| 8 | Discusión | Alcance del 4/4, evidencia independiente, trazabilidad, gap de materialización por archivos y amenazas a la validez |
| 9 | Conclusiones | Respuestas directas, veredicto final, limitaciones y trabajo futuro priorizado |

Bibliografía en `referencias.bib`.

---

## Evidencia

Los capítulos 7 y 8 se apoyan en la evidencia de `evidence/`, no en prosa:

| Ruta | Contenido |
|---|---|
| `evidence/final-experiment/` | Pre-registro, freeze, preflight, cuatro celdas V2, journals, snapshots, receipts y resultados del oráculo externo |
| `evidence/ui-demo-run/` | Demostración no experimental: run entregado, runs adversos, causa observable y oráculo independiente |
| `evidence/scripts/` | Drivers reproducibles; **ninguna cifra reportada se transcribe a mano** |
| `evidence/warehouse/`, `evidence/g6/` y líneas históricas | Antecedentes adversos o inconclusos; no sostienen H-F1/H-F2 |

La autoridad del resultado final es
`evidence/final-experiment/FINAL-REPORT.md`. Warehouse permanece en 1/8; G5,
G6, G7 y SP2 no se suman al denominador V2.
