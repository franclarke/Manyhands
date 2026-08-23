# Trabajo final de Ingeniería en Sistemas de Información — ManyHands

Documento de tesis en **LaTeX** para el Departamento de Ciencias e Ingeniería
de la Computación de la Universidad Nacional del Sur.

> **Historical draft — not current evidence.** El material académico conserva
> evidencia atribuible a sus candidatos y cortes temporales exactos; por sí solo
> **must not be used to close any current architecture gate**.

## Datos del trabajo

- **Título:** *Orquestación de agentes de lenguaje para el desarrollo de software: una arquitectura basada en contratos y descomposición adaptativa con verificación basada en evidencia*.
- **Alumno:** Francisco Clarke (LU 120547).
- **Carrera:** Ingeniería en Sistemas de Información.
- **Directora:** Dra. Ana Gabriela Maguitman.
- **Codirector:** Dr. Federico Martín Schmidt.
- **Institución:** Universidad Nacional del Sur, Bahía Blanca, Argentina.

## Enfoque narrativo

La tesis está dirigida a lectores del área de Sistemas que no necesariamente
conocen ManyHands. Presenta primero el problema y los objetivos; luego explica
las estrategias de diseño, los algoritmos y la implementación; por último,
describe el run experimental *Viaje en Familia* como demostración acotada del
flujo completo.

| Cap. | Contenido principal |
|---|---|
| 1 | Motivación, paradoja de la granularidad, preguntas y objetivos |
| 2 | Agentes, grafos, contratos, aislamiento, evidencia y eventos |
| 3 | Estado del arte y posicionamiento de ManyHands |
| 4 | Política categórica de granularidad y algoritmo de colapso |
| 5 | Grafo híbrido, planificación progresiva, contratos e invariantes |
| 6 | Ejecución, integración, Matriz de Evidencias, entrega y recuperación |
| 7 | Diseño y resultados del experimento *Viaje en Familia* |
| 8 | Interpretación, alcance de la evidencia y amenazas a la validez |
| 9 | Respuestas, contribuciones, lecciones y trabajo futuro |

## Compilación

Requiere una distribución TeX con `pdflatex` y `bibtex` (MiKTeX en Windows o
TeX Live en Linux/macOS). Desde `docs/tesis`:

```bash
pdflatex -interaction=nonstopmode -halt-on-error main.tex
bibtex main
pdflatex -interaction=nonstopmode -halt-on-error main.tex
pdflatex -interaction=nonstopmode -halt-on-error main.tex
```

El resultado es [`main.pdf`](main.pdf). Los auxiliares de compilación no se
versionan; el PDF sí se conserva como snapshot verificable del documento que
acompaña a este archivo.

## Entregables y fuentes

- [`main.pdf`](main.pdf): tesis compilada.
- [`presentacion/ManyHands-presentacion-oral.pptx`](presentacion/ManyHands-presentacion-oral.pptx): presentación oral vigente de 15 diapositivas.
- [`presentacion/guion-presentacion-oral.md`](presentacion/guion-presentacion-oral.md): guion y ledger de fuentes.
- [`presentacion/source/`](presentacion/source/): fuente reproducible de la PPTX.
- [`presentacion/archive/html-v1/`](presentacion/archive/html-v1/): presentación HTML histórica, no canónica.
- [`evidence/viaje-en-familia/`](evidence/viaje-en-familia/): evidencia curada del experimento y bundle del candidato exacto.
- [`evidence/granularity/`](evidence/granularity/): corpus, baseline y harness de granularidad.

## Estado verificado

Última compilación local: **38 páginas**, sin citas o referencias indefinidas y
sin cajas desbordadas. El capítulo experimental identifica el candidato final,
su árbol Git, la Matriz de Evidencias y los resultados reproducidos sobre un
checkout limpio. Las afirmaciones distinguen la validación técnica del
candidato del alcance más acotado de la observación de interfaz.
