# Guía Arquitectónica: manyhands-windows-ipc-acl

> **Ubicación en el Monorepo**: `native/windows-ipc-acl/`  
> **README del Componente Nativo**: [`../../native/windows-ipc-acl/README.md`](../../native/windows-ipc-acl/README.md)  
> **Índice de Módulos Central**: [`../README.md`](../README.md)  
> **Plan Normativo de Referencia**: [`../plans/2026-08-12-correctness-first-system-redesign.md`](../plans/2026-08-12-correctness-first-system-redesign.md)

---

## 1. Visión General y Propósito del Subsistema

En sistemas operativos Windows, los mecanismos de comunicación entre procesos (IPC) y los archivos de secretos locales son vulnerables a accesos no autorizados si no se configuran de forma defensiva:
- **Lectura no autorizada entre usuarios locales**: Si un socket o archivo de claves se crea con permisos por defecto, otros usuarios sin privilegios administrativos podrían conectarse o leer las credenciales.
- **Ataques mediante Reparse Points NTFS (Junctions y Symlinks)**: Procesos maliciosos pueden crear enlaces simbólicos para inducir a un proceso privilegiado a alterar permisos en archivos protegidos del sistema.
- **Suplantación de Tuberías con Nombre (*Pipe Squatting*)**: Si el endpoint del Named Pipe no exige creación exclusiva de la primera instancia, un atacante local puede escuchar previamente en la tubería y secuestrar las comunicaciones.

**`manyhands-windows-ipc-acl`** es un ejecutable nativo desarrollado en **Rust puro sin dependencias externas** (FFI directo con `kernel32.dll` y `advapi32.dll`) que actúa como **guardián de seguridad a nivel de kernel** para `apps/daemon`:

### Problemas Fundamentales que Resuelve

1. **Aplicación y Verificación de DACLs Protegidas (`SE_DACL_PROTECTED`)**: Configura descriptores de seguridad absolutos que eliminan cualquier permiso heredado. La lista de control de acceso contiene **exactamente dos entradas (ACEs)** con control total (`FILE_ALL_ACCESS`): el **Usuario Actual** (*Current User*) y **Local System** (`NT AUTHORITY\SYSTEM`).
2. **Defensa contra Reparse Points**: Abre los recursos con `FILE_FLAG_OPEN_REPARSE_POINT`, inspecciona los atributos del archivo y rechaza inmediatamente cualquier enlace simbólico o directorio de unión (*junction point*).
3. **Propiedad Exclusiva del Named Pipe Público y Proxy Bidireccional (`serve-pipe`)**: En entornos de producción en Windows, Node.js no expone directamente el Named Pipe público. Este helper nativo crea la primera instancia (`FILE_FLAG_FIRST_PIPE_INSTANCE | PIPE_REJECT_REMOTE_CLIENTS`) con la DACL protegida y retransmite tramas hacia un Named Pipe backend privado no anunciado.
4. **Verificación Independiente de Sockets (`verify-pipe`)**: Inspecciona en vivo el descriptor de seguridad del kernel del pipe antes de autorizar el transporte como seguro.

---

## 2. Arquitectura Interna y Componentes

El componente está desarrollado en un único archivo de código fuente Rust de alta cohesión:

```
native/windows-ipc-acl/
├── Cargo.toml                       # Configuración de compilación Rust (cero dependencias externas)
├── README.md                        # Documentación técnica
└── src/
    └── main.rs                      # FFI Win32, DACLs, Reparse Points, Named Pipe Proxy
```

### Desglose de Subsistemas en `src/main.rs`

- **Win32 FFI & Seguridad del Kernel**: Enlaces a `kernel32.dll` y `advapi32.dll` (`CreateFileW`, `CreateNamedPipeW`, `ConnectNamedPipe`, `OpenProcessToken`, `CreateWellKnownSid`, `InitializeAcl`, `AddAccessAllowedAceEx`, `SetSecurityInfo`, `GetSecurityInfo`).
- **Apertura Segura y Validación de Reparse Points (`open_target`)**: Comprueba la bandera `FILE_ATTRIBUTE_REPARSE_POINT` mediante `GetFileInformationByHandleEx`.
- **Gestor de Identidades y SIDs (`current_user_sid`, `local_system_sid`)**: Extrae el SID del usuario actual desde el token del proceso y genera el SID de Local System (`S-1-5-18`).
- **Constructor y Verificador de DACLs (`build_acl`, `apply_acl`, `verify_acl`)**: Construye la ACL con revisión 2 e inserta exclusivamente las 2 ACEs permitidas, verificando la ausencia total de permisos a grupos genéricos (`Everyone`, `Authenticated Users`).
- **Servidor Proxy de Named Pipe (`serve_restricted_pipe`, `proxy_one_frame`)**: Crea el listener del Named Pipe público en modo dúplex con la DACL protegida y retransmite tramas de comunicación hacia el backend privado.

---

## 3. Flujos de Control y Datos

El siguiente diagrama muestra el esquema de proxying seguro del Named Pipe en Windows:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Proceso Cliente (apps/web)                      │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Conecta a Named Pipe Público
                                    ▼ (Validado por Kernel con Protected DACL)
┌────────────────────────────────────────────────────────────────────────┐
│               manyhands-windows-ipc-acl (serve-pipe)                   │
│                                                                        │
│  • Public Endpoint: \\.\pipe\manyhands-daemon-<hash>                   │
│  • Flags: FILE_FLAG_FIRST_PIPE_INSTANCE | PIPE_REJECT_REMOTE_CLIENTS   │
│  • DACL: Exclusivamente [Current User: ALL] + [Local System: ALL]      │
│  • Monitorea stdin: si daemon cae (EOF) ──► ExitProcess(0)             │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Proxy de tramas (bidireccional)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        apps/daemon (Node.js)                           │
│  • Backend Endpoint: \\.\pipe\manyhands-backend-<uuid> (Privado)       │
│  • HMAC-SHA256 Authenticated Frames                                    │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Interfaces Públicas, Comandos CLI y Protocolo

### Sintaxis de Operaciones CLI

```
manyhands-windows-ipc-acl <operación> [argumentos...]
```

| Operación | Parámetros | Propósito |
|---|---|---|
| `apply` | `<directory\|file> <absolute-path>` | Aplica la DACL protegida al archivo o directorio especificado tras verificar que no sea un reparse point. |
| `verify` | `<directory\|file> <absolute-path>` | Inspecciona el recurso y retorna con código `0` si y solo si la DACL contiene estrictamente las 2 ACEs requeridas. |
| `serve-pipe` | `<public-pipe> <backend-pipe>` | Crea el pipe público con DACL protegida y retransmite tramas bidireccionales hacia el backend privado. Emite `READY\n`. |
| `verify-pipe` | `<public-pipe>` | Se conecta como cliente al pipe público, lee su descriptor de seguridad y valida la DACL protegida. |

### Códigos de Salida del Proceso

- `0`: Operación exitosa o verificación superada sin anomalías.
- `1`: Binario invocado en un sistema operativo no Windows.
- `2`: Error de validación de seguridad (DACL no protegida, reparse point detectado, propietario incorrecto o fallo de FFI).

---

## 5. Patrones de Diseño y Estrategias Técnicas

### 1. Construcción de DACLs Protegidas con Exclusión Estricta
A diferencia de herramientas como `icacls.exe`, que dependen de la interpretación de cadenas de texto localizadas, `windows-ipc-acl` opera directamente a nivel binario con los SIDs del kernel:
1. Obtiene los SIDs binarios del usuario actual y Local System.
2. Construye la ACL con revisión 2 e inserta exactamente dos ACEs `FILE_ALL_ACCESS`.
3. Aplica `PROTECTED_DACL_SECURITY_INFORMATION` (`SE_DACL_PROTECTED`) para cortar la herencia de carpetas superiores.

### 2. Reglas de Verificación Inflexible (`verify_acl`)
La función de verificación no se limita a comprobar que el usuario tenga acceso; verifica activamente la ausencia de permisos superfluos:
- Propietario coincide con el usuario actual.
- Control incluye `SE_DACL_PROTECTED`.
- Conteo exacto de ACEs es estrictamente 2.
- Ambas entradas tienen permisos `FILE_ALL_ACCESS`.
- Si existe una entrada para `Everyone`, `Authenticated Users` o cualquier otro principal, la verificación falla inmediatamente.

### 3. Proxy de Named Pipe con Primera Instancia Exclusiva
Para neutralizar ataques de suplantación (*pipe squatting*):
- Invoca `CreateNamedPipeW` con `FILE_FLAG_FIRST_PIPE_INSTANCE`. Si el pipe ya existía, falla de inmediato con `ERROR_ALREADY_EXISTS`.
- Incluye `PIPE_REJECT_REMOTE_CLIENTS` para bloquear cualquier conexión remota vía SMB.

---

## 6. Estado de Transición y Relación con el Rediseño Normativo

Según el plan normativo (`docs/plans/2026-08-12-correctness-first-system-redesign.md`):

1. **Estado de Cierre (Stage 3 / GR)**: El ejecutable nativo y su envoltorio en TypeScript (`apps/daemon/src/windows-ipc-acl.ts`) están cerrados y verificados.
2. **Consumo Productivo**: Utilizado por `apps/daemon` para proteger el archivo de capability (`ipc-capability`) y publicar el Named Pipe seguro en Windows.

---

## 7. Navegación y Referencias

- **README del Componente Nativo**: [`../../native/windows-ipc-acl/README.md`](../../native/windows-ipc-acl/README.md)
- **Módulos Relacionados**:
  - [`daemon.md`](./daemon.md): Servidor principal que utiliza `windows-ipc-acl` para asegurar el transporte IPC.
  - [`windows-job-runner.md`](./windows-job-runner.md): Custodio Win32 complementario para contención de procesos.
  - [`web.md`](./web.md): Cliente web que se conecta al Named Pipe protegido.
- **Documentación Central**: [`../README.md`](../README.md)
