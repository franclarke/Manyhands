# TRABAJO FINAL DE INGENIERÍA EN SISTEMAS DE INFORMACIÓN — TESIS DE MANYHANDS

Este directorio contiene la primera versión completa del documento de tesis en formato **LaTeX** listo para su compilación y presentación ante las autoridades del **Departamento de Ciencias e Ingeniería de la Computación (DCIC) de la Universidad Nacional del Sur (UNS)**.

---

## 📄 DATOS DEL TRABAJO FINAL

- **Título**: *Diseño e implementación de una plataforma de orquestación de agentes de lenguaje para el desarrollo de software y análisis exploratorio de una política de descomposición adaptativa*
- **Alumno**: Francisco Clarke (LU: 120547)
- **Carrera**: Ingeniería en Sistemas de Información
- **Directores**: Dra. Ana Gabriela Maguitman (Directora), Dr. Federico Martín Schmidt (Codirector)
- **Institución**: Universidad Nacional del Sur (UNS), Bahía Blanca, Argentina.

---

## 🛠️ INSTRUCCIONES DE COMPILACIÓN

### Requisitos Previos:
- Una distribución de TeX/LaTeX instalada (ej. **MiKTeX** en Windows, **TeX Live** en Linux/macOS).
- `pdflatex` y `bibtex` o `latexmk`.

### Comando de Compilación Recomendado:

```bash
# Compilación directa con latexmk (recomendado):
latexmk -pdf main.tex

# O compilación manual en 4 pasos (para generar índice y bibliografía):
pdflatex main.tex
bibtex main
pdflatex main.tex
pdflatex main.tex
```

El archivo final generado será **`main.pdf`**.

---

## 📂 ESTRUCTURA DEL DOCUMENTO DE TESIS (`main.tex`)

1. **Carátula Institucional UNS**: Título, Alumno, LU, Directores y Departamento.
2. **Resumen y Abstract**: Resumen ejecutivo en español e inglés.
3. **Índices**: Índice General, de Figuras y de Tablas.
4. **Capítulo 1 — Introducción y Motivación**: Contexto, Paradoja de la Granularidad, Objetivos General y Específicos, Contribuciones.
5. **Capítulo 2 — Estado del Arte y Marco Teórico**: Agentes de lenguaje (SWE-agent, ChatDev, MetaGPT), Orquestación por DAGs (LLMCompiler), Políticas de granularidad/costo (FrugalGPT, RouteLLM), Sandboxing en Git.
6. **Capítulo 3 — Arquitectura y Diseño de ManyHands**: Visión general, Grafo Jerárquico V3 ($GraphRevision$), Decomposer Adaptativo V3 ($C_{task}$), Scheduler Continuo con `ConflictConstraints`, Worktree Recycling Pool, ScopeChecker OS-aware, Matriz de Evidencias, Persistencia durable ($fsync$, SQLite WAL) y Cockpit UI.
7. **Capítulo 4 — Detalles de Implementación y Seguridad**: Arquitectura TypeScript Node.js (`@manyhands/*`), ejecutores de agentes (Claude Code & Codex CLI), indexación nativa Ripgrep, reductor CAS e inmutabilidad profunda (`deepFreeze`).
8. **Capítulo 5 — Evaluación y Análisis Exploratorio**: Casos de estudio, el indicador *Granularity Efficiency Index* ($GEI$), comparación cualitativa/cuantitativa.
9. **Capítulo 6 — Conclusiones y Trabajo Futuro**.
10. **Bibliografía**: `referencias.bib`.
