# Análisis de tesinas de referencia (previo a la reescritura)

> **Fecha:** 2026-07-24 (UTC) · **Etapa 6** · Documento interno de trabajo.
> **Propósito:** extraer el estándar académico e institucional que debe cumplir
> la tesis de ManyHands, a partir de tesinas reales del mismo departamento.
> **Autorización:** GOAL.md declara las tesinas de otros autores como fuente de
> verdad #5 y exige este análisis. Se excluyó todo material propio de Francisco
> y la carpeta de presentación marcada como no legible.

## 1. Inventario

Ubicación: `docs/UNI (NO LEER)/otras tesis/Tesinas/`. Todas son trabajos del
**Departamento de Ciencias e Ingeniería de la Computación, Universidad Nacional
del Sur** — el mismo departamento y, en varios casos, la misma directora que la
tesis de ManyHands.

| Archivo | Autor | Tipo / año | Tamaño | Relevancia |
|---|---|---|---|---|
| `Tesis - Paz Vives.pdf` | María de la Paz Vives | Tesis, 2012 (Dir. **Maguitman**) | 492K | **Alta** — misma directora; estructura canónica |
| `Tesis Juan Manuel Suarez.pdf` | Juan Manuel Suárez | Lic. Cs. Computación, 2022 (Dir. **Maguitman**, Co-dir. Soto) | 404K | **Muy alta** — misma directora, reciente, sistema en producción |
| `Tesis - Pablo Delgado.pdf` | Pablo Horacio Delgado | Lic., 2011 (Dir. **Maguitman**) | 640K | Alta — misma directora |
| `Tesis de Licenciatura Rocio Hubert.pdf` | Rocío Hubert | Licenciatura | 2.6M | Media-alta |
| `Tesis-CeciliaBaggio.pdf` | Cecilia Baggio | Tesis | 3.4M | Media |
| `Tesis de Licenciatura José Ramón García Suárez.pdf` | J. R. García Suárez | Licenciatura | 3.0M | Media |
| `Tesis - Nestor Echegoyen.pdf` | Néstor Echegoyen | Tesis | 1.1M | Media |
| `Tesis - Mitzig y Mitzig.pdf` | Mitzig y Mitzig | Tesis (2 autores) | 1004K | Media |
| `Tesis Federico Paganetto (comentarios Ana).pdf` | F. Paganetto | Tesis con comentarios de la directora | 21M | Alta (muestra criterios de corrección) |
| `Informe de Proyecto Final Villarroel.pdf` | Villarroel | Proyecto Final | 860K | Media |
| `Informe de Proyecto final - Caterina Panzone - Hernán Pochiola.pdf` | Panzone / Pochiola | Proyecto Final | 4.6M | Media |
| `ProyectoFinalMagario.pdf` | Magario | Proyecto Final | 2.4M | Media |

Se leyeron en profundidad las tres de mayor relevancia (Suárez 2022, Vives 2012,
Delgado 2011), por ser de la misma directora y cubrir el rango temporal.

## 2. Análisis comparativo

### 2.1 Estructura macro (patrón dominante)

```text
1. Introducción            → Motivación · Estado actual/Trabajo previo · Objetivos
2. Conceptos preliminares  → marco teórico mínimo necesario, no exhaustivo
3. Metodología propuesta   → formalización de la tarea y del enfoque
4..n. Capítulos técnicos   → un capítulo por componente o etapa del pipeline
n+1. Evaluación            → datos, métricas, resultados
n+2. Conclusiones          → "Resultados obtenidos" + "Trabajo a futuro"
Bibliografía
```

Observaciones:

- La introducción es **breve** (2–4 páginas) y va directo al problema. No hay
  divagación sobre la historia general del área.
- "Conceptos preliminares" existe casi siempre y contiene **solo** lo que el
  lector necesita para entender la contribución. Es un capítulo de servicio, no
  un survey.
- Los capítulos técnicos siguen el **orden del pipeline** del sistema, no el
  orden cronológico del desarrollo.
- Las conclusiones se dividen sistemáticamente en resultados y trabajo futuro.

### 2.2 Estilo y tono

- **Impersonal o primera persona del plural**: "En esta tesis se puso en
  producción un sistema…", "nuestra principal recomendación a futuro es…".
  Nunca primera persona del singular.
- **Sobriedad**: sin adjetivos promocionales. Suárez escribe "Las métricas
  obtenidas son aceptables para una tarea de esta dificultad" — reconoce el
  límite en la misma frase en que reporta el logro.
- **Honestidad explícita sobre defectos**: "El sistema tiene errores a corregir,
  que podrían mitigarse en futuras iteraciones".
- **Alternativas reconocidas**: Suárez dedica un párrafo a "el enfoque planteado
  para esta tarea no es único" y enumera decisiones revisables. Esto **fortalece**
  el trabajo en lugar de debilitarlo.

### 2.3 Bibliografía

- Estilo numérico `[n]` con lista al final.
- Entradas completas: autores (lista larga con `& ... &`), año entre paréntesis,
  título, venue/conferencia/journal, volumen, páginas.
- Mezcla saludable de: papers fundacionales (Vaswani et al. 2017; Hochreiter &
  Schmidhuber 1997), libros de referencia (Goodfellow et al.; Jurafsky &
  Martin), y trabajos aplicados del dominio.
- Volumen típico: **20–25 referencias** en una tesina de licenciatura.
- Toda referencia citada se usa realmente en el texto para sostener una
  afirmación concreta.

### 2.4 Figuras, tablas y resultados

- Figuras numeradas con epígrafe y **referenciadas desde el texto**.
- Las tablas de resultados se **interpretan** en prosa inmediatamente después;
  no se dejan solas.
- No hay capturas decorativas.

## 3. Buenas prácticas detectadas (a adoptar)

1. Introducción corta y problema concreto desde el primer párrafo.
2. Capítulo de conceptos preliminares acotado a lo necesario.
3. Un capítulo por etapa del pipeline, en orden de flujo.
4. Separar **metodología propuesta** de **implementación**.
5. Conclusiones = resultados obtenidos + trabajo futuro, con limitaciones
   explícitas.
6. Tono impersonal, sin superlativos.
7. Reconocer explícitamente que el enfoque elegido no es el único posible.
8. Bibliografía numérica completa y efectivamente usada.

## 4. Errores a evitar (detectados por contraste con el borrador actual)

| Problema del borrador de ManyHands | Estándar observado |
|---|---|
| Resumen con lista de features y adjetivos ("sobresaliente", "ultrarrápido") | Resumen sobrio: problema, enfoque, resultado, límite |
| Afirmar capacidades no implementadas (SQLite WAL) | Solo se afirma lo construido; lo demás va a trabajo futuro |
| Tabla de resultados sin procedencia | Resultados con metodología y datos declarados |
| Casos de estudio narrados como ocurridos sin evidencia | Evaluación con protocolo y datos reales |
| Nomenclatura de producto ("V3") dentro del texto académico | Términos técnicos estables, sin marcas de versión internas |
| Sintaxis Markdown (`**texto**`) dentro de LaTeX | LaTeX válido (`\textbf{}`) |
| Capítulos organizados como documentación de producto ("Pilar 1/2/3") | Capítulos como narrativa de contribución técnica |
| Bibliografía de 8 entradas | 20–25 entradas verificadas |

## 5. Estándar de redacción adoptado para ManyHands

- Español, registro impersonal o plural de modestia.
- Cada afirmación técnica cae en una de estas categorías, y el texto lo deja
  claro: respaldada por código, por tests, por evidencia de runs, por
  bibliografía, interpretación razonable, limitación, o trabajo futuro.
- Ningún número sin procedencia declarada.
- Ninguna capacidad en presente que no exista en la ruta productiva.
- Figuras numeradas, referenciadas e interpretadas.
- Bibliografía numérica, completa, verificada y usada.

## 6. Estructura propuesta para la tesis de ManyHands

```text
Resumen / Abstract
1. Introducción
   1.1 Motivación · 1.2 Planteamiento del problema · 1.3 Objetivos
   1.4 Preguntas de investigación · 1.5 Alcance y limitaciones · 1.6 Organización
2. Conceptos preliminares
   2.1 Agentes de código basados en LLM · 2.2 Grafos de tareas y DAGs
   2.3 Aislamiento con worktrees de Git · 2.4 Verificación basada en evidencia
3. Estado del arte
   3.1 Agentes autónomos · 3.2 Orquestación por grafos · 3.3 Políticas de
   granularidad y costo · 3.4 Posicionamiento de ManyHands
4. Metodología propuesta: descomposición adaptativa
   4.1 La paradoja de la granularidad · 4.2 Índice C_task · 4.3 Frontera
   Planner/política/Graph Compiler · 4.4 Críticos · 4.5 Qué decide cada parte
5. Arquitectura del sistema
   5.1 El run como unidad · 5.2 Grafo y relaciones tipadas · 5.3 Contratos
   5.4 Eventos de dominio y proyecciones
6. Implementación
   6.1 Monorepo · 6.2 Grounding del repositorio · 6.3 Planificación
   6.4 Scheduling · 6.5 Ejecución aislada y seguridad · 6.6 Validación
   6.7 Integración bottom-up y entrega · 6.8 Persistencia y recuperación
   6.9 Interfaz de supervisión
7. Evaluación
   7.1 Protocolo · 7.2 Caso canónico · 7.3 Resultados observados
   7.4 Defectos encontrados y corregidos
8. Discusión
   8.1 Sobre la frontera semántica/determinista · 8.2 Amenazas a la validez
   8.3 Limitaciones
9. Conclusiones
   9.1 Resultados obtenidos · 9.2 Trabajo futuro
Bibliografía
```

**Justificación de los cambios respecto del borrador.** El borrador organiza el
cuerpo en "Pilar 1 / Pilar 2 / Pilar 3", que es la estructura del *producto*, no
de una contribución académica: mezcla propuesta, arquitectura e implementación en
un mismo capítulo y deja la evaluación como apéndice narrativo. La estructura
propuesta separa **qué se propone** (cap. 4), **cómo se diseña** (cap. 5), **cómo
se construye** (cap. 6) y **qué se observó** (cap. 7), que es el patrón de las
tesinas de referencia y permite que el jurado evalúe la contribución sin
conocer el producto.
