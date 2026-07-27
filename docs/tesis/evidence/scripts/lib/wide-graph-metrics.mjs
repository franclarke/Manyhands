/**
 * Catálogo de métricas del barrido ancho — specimen congelado.
 *
 * Cada entrada es una pregunta analítica distinta sobre el escenario
 * `thesis-seed-2026` tal como lo entregó W1 (`71f61c9e`): 4 zonas, 16 bins,
 * 5 SKUs, 8 colocaciones, 170 unidades. Como el seed está congelado, cada
 * pregunta tiene **un solo resultado correcto**, y ese resultado se declara acá.
 *
 * Es la única fuente de verdad: de acá se renderiza el estímulo que recibe el
 * planner y contra acá compara el oráculo externo. Ninguna de las dos cosas
 * puede derivar por su cuenta, que es el defecto que hundió los primeros W1
 * (prompt y oráculo se contradecían).
 *
 * Los valores no fueron transcritos a mano: se derivaron del blob real de
 * `src/scenarios/thesis-seed-2026.ts` en `71f61c9e`. La prueba asociada verifica
 * que las dos particiones independientes del total —por zona y por SKU— sigan
 * sumando lo mismo, que es lo que detecta un error de transcripción.
 *
 * Por qué existe: la primera versión del estímulo pedía N módulos que derivaban
 * los mismos tres valores y sólo se diferenciaban por un id. Eso medía la
 * maquinaria del grafo sobre un fan-out sintético, y un planner lo objetó en vez
 * de construirlo. Acá cada módulo computa algo genuinamente distinto.
 */
export const WIDE_GRAPH_SCENARIO = "thesis-seed-2026";
export const WIDE_GRAPH_TOTAL_UNITS = 170;

export const WIDE_GRAPH_METRICS = Object.freeze([
  {
    id: "zone-unit-totals",
    question: "Total units stored in each zone, keyed by zone id.",
    expected: { "zone-1": 35, "zone-2": 40, "zone-3": 65, "zone-4": 30 }
  },
  {
    id: "sku-unit-totals",
    question: "Total units of each SKU across the whole warehouse, keyed by SKU id.",
    expected: { "SKU-1001": 30, "SKU-1002": 15, "SKU-1003": 42, "SKU-1004": 43, "SKU-1005": 40 }
  },
  {
    id: "bin-occupancy",
    question: "How many bins hold stock, how many are empty, and how many exist.",
    expected: { occupied: 8, empty: 8, total: 16 }
  },
  {
    id: "sku-bin-spread",
    question: "Number of distinct bins each SKU occupies, keyed by SKU id.",
    expected: { "SKU-1001": 2, "SKU-1002": 1, "SKU-1003": 2, "SKU-1004": 2, "SKU-1005": 1 }
  },
  {
    id: "zone-sku-mix",
    question: "Number of distinct SKUs present in each zone, keyed by zone id.",
    expected: { "zone-1": 2, "zone-2": 2, "zone-3": 2, "zone-4": 2 }
  },
  {
    id: "top-bin-by-units",
    question: "The single bin holding the most units, and how many. Ties break on the lowest bin id.",
    expected: { binId: "bin-3-2", units: 40 }
  },
  {
    id: "empty-bin-ids",
    question: "Ids of every bin holding no stock, sorted ascending.",
    expected: ["bin-1-3", "bin-1-4", "bin-2-3", "bin-2-4", "bin-3-3", "bin-3-4", "bin-4-3", "bin-4-4"]
  },
  {
    id: "median-occupied-bin-units",
    question: "Median unit count across bins that hold stock. Even counts average the two middle values.",
    expected: 19
  },
  {
    id: "single-bin-skus",
    question: "SKUs stored in exactly one bin, sorted ascending.",
    expected: ["SKU-1002", "SKU-1005"]
  },
  {
    id: "zone-share-of-units",
    question: "Each zone's share of total warehouse units, rounded to four decimals, keyed by zone id.",
    expected: { "zone-1": 0.2059, "zone-2": 0.2353, "zone-3": 0.3824, "zone-4": 0.1765 }
  },
  {
    id: "sku-zone-presence",
    question: "Zones each SKU appears in, sorted ascending, keyed by SKU id.",
    expected: {
      "SKU-1001": ["zone-1", "zone-2"],
      "SKU-1002": ["zone-1"],
      "SKU-1003": ["zone-2", "zone-4"],
      "SKU-1004": ["zone-3", "zone-4"],
      "SKU-1005": ["zone-3"]
    }
  },
  {
    id: "occupied-bins-per-zone",
    question: "Number of bins holding stock in each zone, keyed by zone id.",
    expected: { "zone-1": 2, "zone-2": 2, "zone-3": 2, "zone-4": 2 }
  },
  {
    id: "unit-quantity-extremes",
    question: "Smallest and largest unit count among bins that hold stock.",
    expected: { min: 10, max: 40 }
  },
  {
    id: "top-bin-concentration",
    question: "Share of total warehouse units held by the single largest bin, rounded to four decimals.",
    expected: 0.2353
  },
  {
    id: "multi-bin-skus",
    question: "SKUs stored in more than one bin, mapped to their sorted bin ids.",
    expected: {
      "SKU-1001": ["bin-1-1", "bin-2-2"],
      "SKU-1003": ["bin-2-1", "bin-4-1"],
      "SKU-1004": ["bin-3-1", "bin-4-2"]
    }
  },
  {
    id: "zone-mean-units-per-occupied-bin",
    question: "Mean units per occupied bin in each zone, rounded to four decimals, keyed by zone id. Zones with no stock report 0.",
    expected: { "zone-1": 17.5, "zone-2": 20, "zone-3": 32.5, "zone-4": 15 }
  }
]);

/**
 * Los tamaños del barrido son prefijos del catálogo, así que N=4 es un
 * subconjunto exacto de N=8 y de N=16. Eso hace la serie comparable por
 * construcción: entre dos tamaños cambia la anchura del grafo y nada más.
 *
 * 24 se retiró. El seed sostiene dieciséis preguntas analíticas genuinamente
 * distintas; llegar a veinticuatro exigía entradas cada vez más artificiales
 * (co-ubicación por pares, análisis por número de slot), que es exactamente la
 * degeneración que este rediseño existe para eliminar. Enriquecer el seed
 * invalidaría el oráculo de W1 y la cadena longitudinal entera.
 */
export const WIDE_GRAPH_SIZES = Object.freeze([4, 8, 16]);

export function metricsFor(moduleCount) {
  if (!WIDE_GRAPH_SIZES.includes(moduleCount)) {
    throw new Error(`Unknown wide graph size ${moduleCount}; expected one of ${WIDE_GRAPH_SIZES.join(", ")}.`);
  }
  return WIDE_GRAPH_METRICS.slice(0, moduleCount);
}

/** `projection-01` implementa la primera entrada del catálogo, y así. */
export function moduleIdFor(index) {
  return `projection-${String(index + 1).padStart(2, "0")}`;
}
