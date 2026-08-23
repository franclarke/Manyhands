# Fuente reproducible de la presentación oral

Esta carpeta contiene la fuente editable del deck vigente
[`../ManyHands-presentacion-oral.pptx`](../ManyHands-presentacion-oral.pptx). El
artefacto archivado tiene 15 diapositivas; las notas del orador se cargan desde
[`../guion-presentacion-oral.md`](../guion-presentacion-oral.md).

## Dependencias

Las dependencias directas quedan fijadas en [`package.json`](package.json):

- `@oai/artifact-tool` `2.8.48` para construir, renderizar y exportar el deck;
- `jszip` `3.10.1` para insertar una transición `fade` en cada slide del PPTX.

## Construcción

Desde este directorio:

```bash
npm install
npm run build
npm run add-transitions
```

El comando equivalente de una sola vez es:

```bash
npm run build:final
```

`build-deck.mjs` escribe el PPTX en el directorio padre. Sus renders de control,
layouts y montaje se generan en `.generated/`, que es salida regenerable y no
forma parte de la fuente. `add-fade-transitions.mjs` modifica ese PPTX para
agregar las 15 transiciones.

Se pueden cambiar las salidas sin editar la fuente mediante `TMP_DIR` y
`FINAL_PPTX`. `PROJECT_ROOT` permite indicar otro checkout; si no se define, el
script resuelve la raíz del repositorio a partir de esta carpeta.

## Inputs relativos

`assets-manifest.json` usa rutas relativas a `PROJECT_ROOT`, nunca rutas
absolutas de la máquina que produjo el deck. Los inputs vigentes son:

- `docs/tesis/assets/uns-emblema.png`;
- las capturas de `docs/tesis/assets/viaje-en-familia/`;
- `docs/tesis/main.pdf`;
- `docs/tesis/presentacion/guion-presentacion-oral.md` para las notas.

`source-notes.txt` mantiene el ledger de fuentes y los límites de atribución del
experimento. Regenerar el PPTX no convierte capturas post-hoc en evidencia
contemporánea ni elimina los caveats allí registrados.

La primera versión HTML se conserva separadamente en
[`../archive/html-v1/`](../archive/html-v1/) como antecedente histórico; no es la
fuente del deck de 15 diapositivas.

