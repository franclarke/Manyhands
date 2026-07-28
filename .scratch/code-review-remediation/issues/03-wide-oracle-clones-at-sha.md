# 03 — El oráculo ancho clona en el SHA entregado

**What to build:** el recibo del oráculo ancho prueba qué commit verificó. Antes confiaba en la ruta recibida y no registraba SHA, por lo que un PASS no podía atribuirse a una entrega.

**Blocked by:** None.

**Status:** closed

- [x] Clona fuera del target y hace checkout del SHA entregado, con instalación congelada, como exige el protocolo.
- [x] El recibo registra el SHA verificado.
- [x] Corre sobre una entrega existente y reproduce un veredicto atribuible al contrato de oráculo correcto.

## Comments

- La entrega histórica N=4 `b7a8838b1db9fa136103e5024df38697072ad3c9`
  fue verificada desde un clon externo en ese SHA. El resultado v2 preservado en
  `oracle-v2-recheck.json` es FAIL porque el estímulo histórico no satisface el
  catálogo value-aware actual; no se fuerza equivalencia con el PASS v1.
