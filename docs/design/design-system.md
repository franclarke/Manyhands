# Sistema visual de ManyHands

> Registro: `product`. La implementación actual de tokens vive en
> `apps/web/src/app/globals.css`. Este documento define la dirección objetivo;
> cualquier valor exacto debe verificarse contra los tokens antes de modificarlo.

## Identidad

**Ember sobre grafito.** ManyHands se siente como un centro de control sereno y
profesional. El color cálido identifica actividad y acción; no decora superficies
inactivas.

- Estrategia restringida: un accent y neutrales jerárquicos.
- Dark puede ser default; light debe tener paridad funcional.
- Sin neón, gradient text, glassmorphism ni grids de cards repetitivas.
- El rojo se reserva para fallos reales; blocked y stale no son fallos.

## Tokens

Los componentes consumen tokens semánticos y de estado:

- `--color-bg`, `--color-surface*`, `--color-text*`, `--color-border*`;
- `--color-accent*` para acción/foco/actividad;
- `--status-*` para estados;
- escala de spacing de 4 px;
- radios técnicos contenidos, máximo 12–16 px en superficies;
- z-index semántico: sticky, popover, dialog backdrop, dialog, toast, tooltip.

No se consumen primitivas de paleta directamente desde componentes.

## Tipografía

- Geist: UI, navegación, labels y prosa.
- JetBrains Mono: IDs, commits, comandos y datos que requieren alineación.
- Newsreader: un momento editorial por pantalla como máximo; nunca controles.
- Escala fija y compacta; cuerpo legible y prosa limitada a 65–75ch.
- Uppercase mono solo para metadatos reales, no como eyebrow decorativo repetido.

## Componentes esenciales

### Node

Muestra nombre comprensible, rol técnico secundario, estado con texto/icono y una
señal breve de actividad. El color de branch no sustituye estado. Debe soportar
selected, focus, ready, running, validating, verified, blocked, needs_input,
stale y failed.

### Typed edge

Jerarquía es el edge default. Artifact requirement, seam y conflict constraint
usan forma, label y patrón distintos. Los edges secundarios pueden ocultarse
hasta que el usuario selecciona un nodo.

### Decision card y dialog

La tarjeta horizontal explica pregunta, razón e impacto. El diálogo contiene
opciones y evidencia. Ambos conservan referencia visible al nodo. Estados:
pending, submitting, conflict/CAS, resolved y expired.

### Inspector

Panel lateral en desktop, sheet en móvil. Secciones progresivas; logs y diffs
completos se cargan bajo demanda.

### Result workspace

Prioriza criteria/evidence, cambios y entrega. No usa métricas heroicas ni cards
idénticas; la composición sigue la lectura de la decisión final.

## Layout

- Sidebar + workspace principal.
- Header compacto y persistente.
- Decision strip sobre el área de trabajo.
- Canvas central e inspector on-demand.
- Resultado reemplaza al canvas como centro en `result_ready`.
- Responsive estructural: sidebar colapsa, inspector se convierte en sheet.

## Motion

Energía de “calma instrumental”, normalmente 150–250 ms con easing out.

| Momento | Movimiento |
|---|---|
| node proposed | fade y desplazamiento corto desde el padre |
| edge materialized | trazo progresivo una vez |
| attempt started | pulso local breve |
| validation | progreso discreto dentro del nodo |
| integration | flujo breve hacia el composite y settle |
| stale | cambio de estado suave, sin shake ni rojo |
| decision raised | entrada de tarjeta sin alterar layout del canvas |

Reglas absolutas:

- no llamar `fitView` ni centrar como efecto de eventos;
- no animar pan, zoom o posiciones elegidas por el usuario;
- no gatear visibilidad de contenido a una animación;
- no usar bounce o elastic;
- cada animación tiene alternativa bajo `prefers-reduced-motion`.

## Accesibilidad

- WCAG 2.2 AA.
- Texto normal 4.5:1; UI y texto grande 3:1 cuando corresponda.
- Focus visible en todos los controles y nodos interactivos.
- Estado expresado con texto/icono además de color.
- Navegación completa por teclado y orden de foco estable.
- Dialogs con nombre accesible, trap de foco y retorno al invocador.
- Live regions limitadas a decisiones, errores importantes y estados terminales.

## Estados de calidad obligatorios

Cada componente interactivo implementa default, hover, focus, active, disabled,
loading y error. Las superficies de datos incluyen loading estructural, empty
educativo, error accionable, contenido largo y viewport pequeño.
