# Pnpm JSON channel

Clasificación: **defecto del instrumento Pilot**.

## Observación

El oráculo del segundo W1 ejecutó correctamente test, typecheck y build. Al
invocar la sonda, `pnpm study:probe` antepuso al JSON el banner de lifecycle con
nombre del paquete y comando. `JSON.parse(stdout)` falló aunque la aplicación sí
había escrito un objeto JSON.

## Causa y corrección TDD

El oráculo confundía stdout del package manager con stdout del programa. La
aplicación no puede suprimir el banner que pnpm 7 agrega antes de lanzar el
script.

- Rojo: una regresión exigió que el core excluya banners del canal JSON.
- Verde: la sonda se invoca como `pnpm --silent study:probe ...`; los hashes del
  core y de los ocho manifests fueron actualizados.
- Verificación: 19 tests de assets Warehouse PASS.

El modo silencioso no descarta stderr ni altera el objeto de la aplicación. La
ejecución original permanece FAIL; la corrección sólo se aplica a intentos
posteriores.
