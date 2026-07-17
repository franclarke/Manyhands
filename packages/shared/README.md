# @manyhands/shared

Capa más baja del monorepo: primitivos validados y helpers puros sin dependencia
de otros packages.

Incluye actualmente IDs, timestamps y utilidades deterministas de conjuntos,
scores y pares.

## Dirección objetivo

`shared` solo contiene conceptos realmente transversales y sin semántica de
orquestación. TaskGraph, contracts, events, artifacts y decisions pertenecen a
sus packages de dominio, no a un barrel global.

No agregar dependencias de framework, filesystem, git, web o providers.
