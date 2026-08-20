# manyhands-windows-ipc-acl

Herramienta nativa en Rust puro (sin dependencias externas, FFI directo con Win32 `kernel32` y `advapi32`) que implementa la protección y verificación estricta de listas de control de acceso discrecionales (DACLs) en el sistema operativo Windows, defensa contra *reparse points* (enlaces y uniones NTFS) y proxying seguro de tuberías con nombre (*Named Pipes*) para ManyHands.

---

## 1. Propósito y Responsabilidad en ManyHands

En entornos de ejecución multiusuario o estaciones de trabajo compartidas en Windows, los mecanismos de comunicación entre procesos (IPC) y los archivos de secretos locales son vulnerables a:
- **Lectura no autorizada entre usuarios locales**: Si un archivo de secretos o un *Named Pipe* se crea con los permisos predeterminados del sistema, otros usuarios sin privilegios administrativos podrían conectarse al socket o leer las claves de autenticación.
- **Ataques de redirección mediante uniones y enlaces simbólicos NTFS (*Reparse Points / Junction Traversal*)**: Un proceso malicioso podría crear un enlace simbólico que apunte a un directorio crítico del sistema operativo, engañando a las rutinas de seguridad para que alteren los permisos de archivos protegidos.
- **Herencia de permisos insegura**: Las DACLs heredadas de carpetas superiores pueden conceder acceso a grupos amplios como `Authenticated Users` o `Everyone`.

`manyhands-windows-ipc-acl` resuelve estas amenazas actuando como el **guardián de seguridad a nivel de kernel** para `@manyhands/daemon`:

1. **Aplicación y Verificación de DACLs Protegidas (`SE_DACL_PROTECTED`)**: Configura descriptores de seguridad absolutos que eliminan explícitamente cualquier permiso heredado o permisos a grupos genéricos. La DACL resultante contiene **exactamente dos entradas (ACEs)** con control total (`FILE_ALL_ACCESS`): el **Usuario Actual** (*Current User*) y **Local System** (`NT AUTHORITY\SYSTEM`).
2. **Defensa contra Reparse Points**: Abre los recursos con `FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS`, inspecciona los atributos del archivo mediante `GetFileInformationByHandleEx` y rechaza inmediatamente cualquier enlace simbólico o directorio de unión (*junction point*).
3. **Propiedad Exclusiva del Named Pipe Público y Proxy Bidireccional (`serve-pipe`)**: En entornos de producción en Windows, Node.js no crea ni expone directamente el Named Pipe público. En su lugar, este helper nativo crea la primera instancia (`FILE_FLAG_FIRST_PIPE_INSTANCE | PIPE_REJECT_REMOTE_CLIENTS`) con la DACL protegida y retransmite tramas de comunicación individuales hacia un Named Pipe backend privado y no anunciado perteneciente al proceso de Node.js.
4. **Verificación Independiente de Sockets (`verify-pipe`)**: Inspecciona en vivo el handle del pipe público antes de que el daemon reporte su nivel de seguridad de transporte como `os_restricted`.

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

## 2. Arquitectura Modular Interna

El componente está escrito en Rust estándar puro, prescindiendo de dependencias externas como `winapi` o `windows-sys` para garantizar una compilación liviana, determinista y auditable:

```
native/windows-ipc-acl/
├── Cargo.toml                       # Configuración de compilación Rust (zero dependencies)
├── README.md                        # Documentación técnica
└── src/
    └── main.rs                      # Implementación de FFI Win32, DACLs, Reparse Points, Named Pipe Proxy
```

### Desglose de Subsistemas en `src/main.rs`

- **Win32 FFI & Seguridad del Kernel**:
  - Enlaces a `kernel32.dll` y `advapi32.dll`: `CreateFileW`, `CreateNamedPipeW`, `ConnectNamedPipe`, `DisconnectNamedPipe`, `ReadFile`, `WriteFile`, `OpenProcessToken`, `GetTokenInformation`, `CreateWellKnownSid`, `GetLengthSid`, `CopySid`, `EqualSid`, `InitializeAcl`, `AddAccessAllowedAceEx`, `GetAce`, `InitializeSecurityDescriptor`, `SetSecurityDescriptorOwner`, `SetSecurityDescriptorDacl`, `SetSecurityDescriptorControl`, `GetSecurityDescriptorControl`, `SetSecurityInfo`, `GetSecurityInfo`, `LocalFree`.
  - Estructuras C de Win32: `Acl`, `AceHeader`, `AccessAllowedAce`, `AbsoluteSecurityDescriptor`, `SecurityAttributes`, `TokenUser`, `FileAttributeTagInfo`.
- **Módulo de Apertura Segura y Validación de Reparse Points (`open_target`)**:
  - Abre archivos y directorios con `FILE_FLAG_OPEN_REPARSE_POINT`.
  - Lee `FileAttributeTagInfo` y comprueba la bandera `FILE_ATTRIBUTE_REPARSE_POINT`. Si el objetivo es un enlace simbólico o junction, la operación falla de inmediato.
- **Gestor de Identidades y SIDs (`current_user_sid`, `local_system_sid`)**:
  - Extrae el SID del usuario actual consultando el token del proceso con `OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY)`.
  - Construye el SID de Local System (`S-1-5-18`) mediante `CreateWellKnownSid(WinLocalSystemSid)`.
- **Constructor y Verificador de DACLs (`build_acl`, `apply_acl`, `verify_acl`)**:
  - Crea una lista de control de acceso con revisión `ACL_REVISION` (2) e inserta exactamente dos entradas `ACCESS_ALLOWED_ACE_TYPE`:
    - Usuario actual: `FILE_ALL_ACCESS` con banderas `OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE` en directorios.
    - Local System: `FILE_ALL_ACCESS` con banderas equivalentes.
  - Al aplicar la seguridad, utiliza `PROTECTED_DACL_SECURITY_INFORMATION` (`SE_DACL_PROTECTED`) para cortar la herencia.
  - Al verificar, comprueba que el propietario sea el usuario actual, que la DACL esté protegida contra herencia, que el conteo de ACEs sea estrictamente 2 y que ningún otro principal tenga acceso concedido.
- **Servidor Proxy de Named Pipe (`serve_restricted_pipe`, `proxy_one_frame`)**:
  - Crea el listener del Named Pipe público en modo dúplex con la DACL protegida.
  - Emite `READY\n` en `stdout` cuando está listo para recibir conexiones.
  - Al aceptar un cliente, retransmite tramas en un hilo independiente hacia el Named Pipe privado de backend (`proxy_one_frame`).

---

## 3. Patrones de Diseño y Estrategias Técnicas

### 3.1. Construcción de DACLs Protegidas con Exclusión Estricta

A diferencia de las herramientas estándar como `icacls.exe`, que dependen de la interpretación de cadenas de texto localizadas (susceptibles a errores en sistemas operativos en diferentes idiomas), `windows-ipc-acl` opera directamente a nivel binario con los SIDs del kernel:

```rust
// 1. Obtener SIDs binarios del usuario actual y Local System
let user = current_user_sid()?;
let system = local_system_sid()?;

// 2. Construir buffer de memoria para la ACL
let mut acl_storage = build_acl(user.as_mut_ptr(), system.as_mut_ptr(), flags)?;
let acl = acl_storage.as_mut_ptr() as *mut Acl;

// 3. Aplicar descriptor de seguridad con SE_DACL_PROTECTED
SetSecurityInfo(
    handle,
    SE_FILE_OBJECT,
    DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
    null_mut(), // No cambia el propietario
    null_mut(), // No cambia el grupo
    acl,        // DACL explícita de 2 entradas
    null_mut(),
);
```

### 3.2. Reglas de Verificación Inflexible (`verify_acl`)

La función de verificación no se limita a comprobar que el usuario tenga acceso; verifica activamente la ausencia total de permisos superfluos:
- **Verificación de Dueño**: `owner == current_user_sid`.
- **Protección contra Herencia**: `control & SE_DACL_PROTECTED != 0`.
- **Conteo Exacto de ACEs**: `dacl.ace_count == 2`.
- **Tipos de Acceso**: Ambas entradas deben ser `ACCESS_ALLOWED_ACE_TYPE` con máscara `FILE_ALL_ACCESS` (0x001F01FF).
- **Prohibición de Principales Desconocidos**: Si existe una entrada para `Everyone`, `Authenticated Users`, `Administrators` o cualquier otro SID que no sea el usuario actual o Local System, la verificación falla con error.

### 3.3. Proxy de Named Pipe con Primera Instancia Exclusiva

Para evitar que un proceso atacante cree el Named Pipe antes que ManyHands (*pipe squatting*):
1. El helper invoca `CreateNamedPipeW` con `FILE_FLAG_FIRST_PIPE_INSTANCE`. Si el pipe ya existía, la llamada falla de inmediato con `ERROR_ALREADY_EXISTS`.
2. Incluye la bandera `PIPE_REJECT_REMOTE_CLIENTS` para bloquear cualquier intento de conexión a través de la red / SMB.
3. El proceso de Node.js escucha únicamente en un pipe privado no anunciado. El helper actúa como intermediario seguro de tramas.

---

## 4. Puntos de Entrada, Interfaces y Comandos CLI

### 4.1. Sintaxis de Comandos CLI

```
manyhands-windows-ipc-acl <operación> [argumentos...]
```

| Operación | Parámetros | Propósito |
|---|---|---|
| `apply` | `<directory\|file> <absolute-path>` | Aplica la DACL protegida al archivo o directorio especificado tras validar que no sea un reparse point. |
| `verify` | `<directory\|file> <absolute-path>` | Inspecciona el archivo o directorio y sale con código `0` si y solo si el dueño y la DACL cumplen con las 2 ACEs requeridas. |
| `serve-pipe` | `<public-pipe> <backend-pipe>` | Crea el pipe público con DACL protegida y retransmite tramas bidireccionales hacia el pipe privado de backend. Emite `READY\n`. |
| `verify-pipe` | `<public-pipe>` | Se conecta como cliente al pipe público, lee su descriptor de seguridad del kernel y valida la DACL protegida. |

### 4.2. Códigos de Salida del Proceso

- `0`: Operación exitosa o verificación superada sin anomalías.
- `1`: El binario fue invocado en un sistema operativo no Windows.
- `2`: Error de validación de seguridad (DACL no protegida, reparse point detectado, propietario incorrecto o fallo de FFI).

---

## 5. Integración con TypeScript (`apps/daemon/src/windows-ipc-acl.ts`)

`apps/daemon` encapsula este binario mediante funciones auxiliares fuertemente tipadas:

```typescript
import {
  createWindowsIpcAclProtector,
  createWindowsIpcAclVerifier,
  startWindowsRestrictedNamedPipeProxy,
  verifyWindowsRestrictedNamedPipe
} from "./windows-ipc-acl.js";

// 1. Proteger el archivo de capability de instalación
const protect = createWindowsIpcAclProtector("C:\\Manyhands\\native\\windows-ipc-acl.exe");
await protect("C:\\Manyhands\\.manyhands\\daemon\\installation\\ipc-capability");

// 2. Verificar la DACL del archivo
const verify = createWindowsIpcAclVerifier("C:\\Manyhands\\native\\windows-ipc-acl.exe");
await verify("C:\\Manyhands\\.manyhands\\daemon\\installation\\ipc-capability");

// 3. Iniciar el proxy de Named Pipe en producción
const proxy = await startWindowsRestrictedNamedPipeProxy({
  helperPath: "C:\\Manyhands\\native\\windows-ipc-acl.exe",
  publicEndpoint: "\\\\.\\pipe\\manyhands-daemon-prod",
  backendEndpoint: "\\\\.\\pipe\\manyhands-backend-priv"
});

// 4. Verificar que el pipe público creado cumpla con las restricciones del SO
await verifyWindowsRestrictedNamedPipe({
  helperPath: "C:\\Manyhands\\native\\windows-ipc-acl.exe",
  endpoint: "\\\\.\\pipe\\manyhands-daemon-prod"
});

// Al cerrar el daemon:
await proxy.close();
```

---

## 6. Estado de Transición y Brechas Arquitectónicas

De acuerdo con el plan de rediseño normativo (`docs/plans/2026-08-12-correctness-first-system-redesign.md`):

- **Etapa 3 / GR (Run Daemon Core & Local IPC Security)**: `windows-ipc-acl` es el pilar de seguridad requerido en Windows para declarar el transporte como `os_restricted`, garantizando que la capability y las tuberías locales estén blindadas contra elevación de privilegios local.
- **Etapa 7 / GA & Etapa 8 / GLeaf**: Provee la protección de directorios para los almacenes de artefactos y el intermediador de credenciales temporales.
- **Sin Binarios Compilados en el Repositorio**: El ejecutable debe compilarse localmente con Cargo antes de desplegar ManyHands en modo producción en Windows.

---

## 7. Comandos de Verificación y Testing

```bash
# Verificación de compilación y análisis estático con Cargo
cargo check --manifest-path native/windows-ipc-acl/Cargo.toml

# Compilación optimizada para producción
cargo build --release --manifest-path native/windows-ipc-acl/Cargo.toml

# Ejecución de pruebas de integración de IPC y DACLs en daemon
pnpm vitest run apps/daemon/test/local-ipc-server.test.ts
```
