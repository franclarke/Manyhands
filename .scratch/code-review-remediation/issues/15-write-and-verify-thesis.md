# 15 — La tesis queda escrita y verificable

**What to build:** el manuscrito presenta el aporte, método, resultados y limitaciones de forma consistente con la matriz de evidencia cerrada y genera un artefacto revisable.

**Blocked by:** 14 — la narrativa final no se escribe sobre claims todavía abiertos.

**Status:** closed

- [x] El texto de la tesis deriva sus afirmaciones de la matriz de claims cerrada.
- [x] Las tablas y figuras distinguen series comparables, evidencia mecánica y resultados descartados.
- [x] La compilación de LaTeX termina sin referencias o citas rotas.
- [x] Una revisión final contrasta el manuscrito contra H1, H2 y las secciones "Qué no se concluye".

## Cierre — 2026-07-30

- **La línea Warehouse entró al manuscrito**, que hasta ahora no la mencionaba
  en absoluto: nueva sección 7.7 con instrumento, cadena longitudinal 1/8,
  barrido ancho sin entrega, resultados antiguos etiquetados como evidencia
  mecánica y el veredicto sobre la duplicación de validación, cada afirmación
  derivada de la matriz rederivada del ticket 14.
- **Tablas que distinguen las series**: cuadro 7.7 lista las tres series anchas
  con su causa terminal; cuadro 7.8 contrasta intenciones compartidas contra
  particionadas y declara en su epígrafe que término, fórmula y umbral no
  cambiaron entre filas.
- **Limitaciones ampliadas**: parámetros provisionales con la razón por la que no
  están anclados, ninguna serie ancha entregó, cadena en 1/8, y el veredicto no
  re-midió el caso motivador a su anchura.
- **Conclusiones**: párrafo nuevo que separa el resultado negativo sobre escala
  del resultado positivo sobre el término.
- **Dos corrupciones de archivo reparadas**: cinco `\textbf` habían quedado como
  tabulador + `extbf`, y un `\ref` como retorno de carro + `ef`, que renderizaba
  «efsec:defecto-medicion» en la página 38.
- **Compilación limpia**: `main.pdf` 47 páginas y `presentacion.pdf` 30 páginas,
  sin errores, sin referencias indefinidas y sin citas rotas.
- **Revisión visual** de las páginas nuevas de ambos PDFs: tablas, negritas y
  referencias cruzadas correctas.
