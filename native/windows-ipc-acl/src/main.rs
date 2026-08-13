#![cfg_attr(not(target_os = "windows"), allow(dead_code))]

#[cfg(not(target_os = "windows"))]
fn main() {
    eprintln!("manyhands-windows-ipc-acl is supported only on Windows");
    std::process::exit(1);
}

#[cfg(target_os = "windows")]
mod windows {
    use std::ffi::{c_void, OsStr, OsString};
    use std::io::{self, Read, Write};
    use std::mem::{size_of, zeroed};
    use std::os::windows::ffi::OsStrExt;
    use std::ptr::null_mut;
    use std::thread;
    use std::time::{Duration, Instant};

    type Bool = i32;
    type Dword = u32;
    type Handle = *mut c_void;
    type Psid = *mut c_void;
    type SecurityDescriptor = *mut c_void;

    const INVALID_HANDLE_VALUE: Handle = -1isize as Handle;
    const TOKEN_QUERY: Dword = 0x0008;
    const READ_CONTROL: Dword = 0x0002_0000;
    const WRITE_DAC: Dword = 0x0004_0000;
    const GENERIC_READ: Dword = 0x8000_0000;
    const GENERIC_WRITE: Dword = 0x4000_0000;
    const FILE_SHARE_READ: Dword = 0x0000_0001;
    const FILE_SHARE_WRITE: Dword = 0x0000_0002;
    const FILE_SHARE_DELETE: Dword = 0x0000_0004;
    const OPEN_EXISTING: Dword = 3;
    const FILE_FLAG_OPEN_REPARSE_POINT: Dword = 0x0020_0000;
    const FILE_FLAG_BACKUP_SEMANTICS: Dword = 0x0200_0000;
    const FILE_ATTRIBUTE_DIRECTORY: Dword = 0x0000_0010;
    const FILE_ATTRIBUTE_REPARSE_POINT: Dword = 0x0000_0400;
    const FILE_ATTRIBUTE_TAG_INFO_CLASS: i32 = 9;
    const SE_FILE_OBJECT: Dword = 1;
    const SE_KERNEL_OBJECT: Dword = 6;
    const OWNER_SECURITY_INFORMATION: Dword = 0x0000_0001;
    const DACL_SECURITY_INFORMATION: Dword = 0x0000_0004;
    const PROTECTED_DACL_SECURITY_INFORMATION: Dword = 0x8000_0000;
    const SE_DACL_PROTECTED: u16 = 0x1000;
    const ACL_REVISION: Dword = 2;
    const ACCESS_ALLOWED_ACE_TYPE: u8 = 0;
    const OBJECT_INHERIT_ACE: u8 = 0x01;
    const CONTAINER_INHERIT_ACE: u8 = 0x02;
    const FILE_ALL_ACCESS: Dword = 0x001f_01ff;
    const PIPE_ACCESS_DUPLEX: Dword = 0x0000_0003;
    const FILE_FLAG_FIRST_PIPE_INSTANCE: Dword = 0x0008_0000;
    const PIPE_REJECT_REMOTE_CLIENTS: Dword = 0x0000_0008;
    const PIPE_UNLIMITED_INSTANCES: Dword = 255;
    const ERROR_FILE_NOT_FOUND: Dword = 2;
    const ERROR_BROKEN_PIPE: Dword = 109;
    const ERROR_PIPE_BUSY: Dword = 231;
    const ERROR_PIPE_CONNECTED: Dword = 535;
    const SECURITY_DESCRIPTOR_REVISION: Dword = 1;
    const MAX_PROXY_FRAME_BYTES: usize = 1024 * 1024;
    const WIN_LOCAL_SYSTEM_SID: i32 = 22;
    const SECURITY_MAX_SID_SIZE: usize = 68;

    #[repr(C)]
    struct SidAndAttributes {
        sid: Psid,
        attributes: Dword,
    }

    #[repr(C)]
    struct TokenUser {
        user: SidAndAttributes,
    }

    #[repr(C)]
    struct FileAttributeTagInfo {
        file_attributes: Dword,
        reparse_tag: Dword,
    }

    #[repr(C)]
    struct Acl {
        revision: u8,
        reserved1: u8,
        size: u16,
        ace_count: u16,
        reserved2: u16,
    }

    #[repr(C)]
    struct AceHeader {
        ace_type: u8,
        ace_flags: u8,
        ace_size: u16,
    }

    #[repr(C)]
    struct AccessAllowedAce {
        header: AceHeader,
        mask: Dword,
        sid_start: Dword,
    }

    #[repr(C)]
    struct AbsoluteSecurityDescriptor {
        revision: u8,
        reserved: u8,
        control: u16,
        owner: Psid,
        group: Psid,
        sacl: *mut Acl,
        dacl: *mut Acl,
    }

    #[repr(C)]
    struct SecurityAttributes {
        length: Dword,
        security_descriptor: *mut c_void,
        inherit_handle: Bool,
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn CreateFileW(
            name: *const u16,
            desired_access: Dword,
            share_mode: Dword,
            security_attributes: *mut c_void,
            creation_disposition: Dword,
            flags_and_attributes: Dword,
            template_file: Handle,
        ) -> Handle;
        fn CreateNamedPipeW(
            name: *const u16,
            open_mode: Dword,
            pipe_mode: Dword,
            max_instances: Dword,
            out_buffer_size: Dword,
            in_buffer_size: Dword,
            default_timeout: Dword,
            security_attributes: *mut SecurityAttributes,
        ) -> Handle;
        fn ConnectNamedPipe(pipe: Handle, overlapped: *mut c_void) -> Bool;
        fn DisconnectNamedPipe(pipe: Handle) -> Bool;
        fn ReadFile(
            file: Handle,
            buffer: *mut c_void,
            bytes_to_read: Dword,
            bytes_read: *mut Dword,
            overlapped: *mut c_void,
        ) -> Bool;
        fn WriteFile(
            file: Handle,
            buffer: *const c_void,
            bytes_to_write: Dword,
            bytes_written: *mut Dword,
            overlapped: *mut c_void,
        ) -> Bool;
        fn FlushFileBuffers(file: Handle) -> Bool;
        fn WaitNamedPipeW(name: *const u16, timeout: Dword) -> Bool;
        fn CloseHandle(handle: Handle) -> Bool;
        fn GetCurrentProcess() -> Handle;
        fn GetFileInformationByHandleEx(
            file: Handle,
            info_class: i32,
            information: *mut c_void,
            size: Dword,
        ) -> Bool;
        fn LocalFree(memory: *mut c_void) -> *mut c_void;
        fn ExitProcess(exit_code: Dword) -> !;
    }

    #[link(name = "advapi32")]
    extern "system" {
        fn OpenProcessToken(process: Handle, desired_access: Dword, token: *mut Handle) -> Bool;
        fn GetTokenInformation(
            token: Handle,
            information_class: i32,
            information: *mut c_void,
            information_length: Dword,
            return_length: *mut Dword,
        ) -> Bool;
        fn GetLengthSid(sid: Psid) -> Dword;
        fn CopySid(destination_length: Dword, destination: Psid, source: Psid) -> Bool;
        fn EqualSid(first: Psid, second: Psid) -> Bool;
        fn CreateWellKnownSid(sid_type: i32, domain_sid: Psid, sid: Psid, size: *mut Dword)
            -> Bool;
        fn InitializeAcl(acl: *mut Acl, size: Dword, revision: Dword) -> Bool;
        fn AddAccessAllowedAceEx(
            acl: *mut Acl,
            revision: Dword,
            ace_flags: Dword,
            access_mask: Dword,
            sid: Psid,
        ) -> Bool;
        fn GetAce(acl: *mut Acl, index: Dword, ace: *mut *mut c_void) -> Bool;
        fn GetSecurityInfo(
            handle: Handle,
            object_type: Dword,
            security_information: Dword,
            owner: *mut Psid,
            group: *mut Psid,
            dacl: *mut *mut Acl,
            sacl: *mut *mut Acl,
            descriptor: *mut SecurityDescriptor,
        ) -> Dword;
        fn SetSecurityInfo(
            handle: Handle,
            object_type: Dword,
            security_information: Dword,
            owner: Psid,
            group: Psid,
            dacl: *mut Acl,
            sacl: *mut Acl,
        ) -> Dword;
        fn GetSecurityDescriptorControl(
            descriptor: SecurityDescriptor,
            control: *mut u16,
            revision: *mut Dword,
        ) -> Bool;
        fn InitializeSecurityDescriptor(descriptor: *mut c_void, revision: Dword) -> Bool;
        fn SetSecurityDescriptorDacl(
            descriptor: *mut c_void,
            dacl_present: Bool,
            dacl: *mut Acl,
            dacl_defaulted: Bool,
        ) -> Bool;
        fn SetSecurityDescriptorOwner(
            descriptor: *mut c_void,
            owner: Psid,
            owner_defaulted: Bool,
        ) -> Bool;
        fn SetSecurityDescriptorControl(
            descriptor: *mut c_void,
            control_bits_of_interest: u16,
            control_bits_to_set: u16,
        ) -> Bool;
    }

    struct OwnedHandle(Handle);

    unsafe impl Send for OwnedHandle {}

    impl Drop for OwnedHandle {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }

    struct LocalMemory(SecurityDescriptor);

    impl Drop for LocalMemory {
        fn drop(&mut self) {
            unsafe {
                LocalFree(self.0);
            }
        }
    }

    #[derive(Clone, Copy)]
    enum TargetKind {
        Directory,
        File,
        Pipe,
    }

    pub fn run() -> Result<(), String> {
        let mut args = std::env::args_os().skip(1);
        let operation = args.next().ok_or_else(usage)?;
        if operation == "serve-pipe" {
            let public_endpoint = args.next().ok_or_else(usage)?;
            let backend_endpoint = args.next().ok_or_else(usage)?;
            if args.next().is_some() {
                return Err(usage());
            }
            return serve_restricted_pipe(public_endpoint, backend_endpoint);
        }
        if operation == "verify-pipe" {
            let endpoint = args.next().ok_or_else(usage)?;
            if args.next().is_some() {
                return Err(usage());
            }
            return verify_restricted_pipe(&endpoint);
        }
        let kind = parse_kind(args.next().ok_or_else(usage)?)?;
        let path = args.next().ok_or_else(usage)?;
        if args.next().is_some() {
            return Err(usage());
        }
        let access = if operation == "apply" {
            READ_CONTROL | WRITE_DAC
        } else {
            READ_CONTROL
        };
        let handle = open_target(&path, kind, access)?;
        let user = current_user_sid()?;
        let system = local_system_sid()?;
        if operation == "apply" {
            verify_owner(handle.0, user.as_ptr() as Psid)?;
            apply_acl(
                handle.0,
                kind,
                user.as_ptr() as Psid,
                system.as_ptr() as Psid,
            )?;
        } else if operation != "verify" {
            return Err(usage());
        }
        verify_acl(
            handle.0,
            kind,
            user.as_ptr() as Psid,
            system.as_ptr() as Psid,
        )
        .map_err(|error| format!("ACL verification failed: {error}"))
    }

    fn usage() -> String {
        "usage: manyhands-windows-ipc-acl <apply|verify> <directory|file> <absolute-path> | serve-pipe <public-pipe> <backend-pipe> | verify-pipe <public-pipe>".into()
    }

    fn parse_kind(value: OsString) -> Result<TargetKind, String> {
        match value.to_str() {
            Some("directory") => Ok(TargetKind::Directory),
            Some("file") => Ok(TargetKind::File),
            _ => Err(usage()),
        }
    }

    struct RestrictedPipeSecurity {
        _user: Vec<u8>,
        _system: Vec<u8>,
        _acl: Vec<u32>,
        descriptor: Box<AbsoluteSecurityDescriptor>,
    }

    impl RestrictedPipeSecurity {
        fn new() -> Result<Self, String> {
            let mut user = current_user_sid()?;
            let mut system = local_system_sid()?;
            let mut acl = build_acl(user.as_mut_ptr() as Psid, system.as_mut_ptr() as Psid, 0)?;
            let mut descriptor: Box<AbsoluteSecurityDescriptor> = Box::new(unsafe { zeroed() });
            let descriptor_pointer = descriptor.as_mut() as *mut _ as *mut c_void;
            if unsafe {
                InitializeSecurityDescriptor(descriptor_pointer, SECURITY_DESCRIPTOR_REVISION)
            } == 0
            {
                return Err(last_error("initializing named-pipe security descriptor"));
            }
            if unsafe {
                SetSecurityDescriptorOwner(descriptor_pointer, user.as_mut_ptr() as Psid, 0)
            } == 0
            {
                return Err(last_error("setting named-pipe owner"));
            }
            if unsafe {
                SetSecurityDescriptorDacl(descriptor_pointer, 1, acl.as_mut_ptr() as *mut Acl, 0)
            } == 0
            {
                return Err(last_error("setting named-pipe DACL"));
            }
            if unsafe {
                SetSecurityDescriptorControl(
                    descriptor_pointer,
                    SE_DACL_PROTECTED,
                    SE_DACL_PROTECTED,
                )
            } == 0
            {
                return Err(last_error("protecting named-pipe DACL"));
            }
            Ok(Self {
                _user: user,
                _system: system,
                _acl: acl,
                descriptor,
            })
        }

        fn attributes(&mut self) -> SecurityAttributes {
            SecurityAttributes {
                length: size_of::<SecurityAttributes>() as Dword,
                security_descriptor: self.descriptor.as_mut() as *mut _ as *mut c_void,
                inherit_handle: 0,
            }
        }
    }

    fn serve_restricted_pipe(
        public_endpoint: OsString,
        backend_endpoint: OsString,
    ) -> Result<(), String> {
        validate_pipe_endpoint(&public_endpoint)?;
        validate_pipe_endpoint(&backend_endpoint)?;
        if public_endpoint == backend_endpoint {
            return Err("public and backend named-pipe endpoints must differ".into());
        }

        let mut security = RestrictedPipeSecurity::new()?;
        let user = current_user_sid()?;
        let system = local_system_sid()?;
        let mut listener = create_restricted_pipe(&public_endpoint, true, &mut security)?;
        verify_acl_for_object(
            listener.0,
            TargetKind::Pipe,
            user.as_ptr() as Psid,
            system.as_ptr() as Psid,
            SE_KERNEL_OBJECT,
        )?;

        println!("READY");
        io::stdout()
            .flush()
            .map_err(|error| format!("publishing pipe readiness failed: {error}"))?;
        thread::spawn(|| {
            let mut input = io::stdin();
            let mut byte = [0u8; 1];
            loop {
                match input.read(&mut byte) {
                    Ok(0) | Err(_) => unsafe { ExitProcess(0) },
                    Ok(_) => {}
                }
            }
        });

        loop {
            connect_server_pipe(listener.0)?;
            let connected = listener;
            listener = create_restricted_pipe(&public_endpoint, false, &mut security)?;
            let backend = backend_endpoint.clone();
            thread::spawn(move || {
                let _ = proxy_one_frame(connected, &backend);
            });
        }
    }

    fn verify_restricted_pipe(endpoint: &OsStr) -> Result<(), String> {
        validate_pipe_endpoint(endpoint)?;
        let handle = connect_client_pipe(
            endpoint,
            GENERIC_READ | GENERIC_WRITE | READ_CONTROL,
            Duration::from_secs(5),
        )?;
        let user = current_user_sid()?;
        let system = local_system_sid()?;
        verify_acl_for_object(
            handle.0,
            TargetKind::Pipe,
            user.as_ptr() as Psid,
            system.as_ptr() as Psid,
            SE_KERNEL_OBJECT,
        )
        .map_err(|error| format!("named-pipe ACL verification failed: {error}"))
    }

    fn create_restricted_pipe(
        endpoint: &OsStr,
        first_instance: bool,
        security: &mut RestrictedPipeSecurity,
    ) -> Result<OwnedHandle, String> {
        let endpoint = wide_pipe_endpoint(endpoint)?;
        let mut attributes = security.attributes();
        let handle = unsafe {
            CreateNamedPipeW(
                endpoint.as_ptr(),
                PIPE_ACCESS_DUPLEX
                    | WRITE_DAC
                    | if first_instance {
                        FILE_FLAG_FIRST_PIPE_INSTANCE
                    } else {
                        0
                    },
                PIPE_REJECT_REMOTE_CLIENTS,
                PIPE_UNLIMITED_INSTANCES,
                64 * 1024,
                64 * 1024,
                0,
                &mut attributes,
            )
        };
        if handle == INVALID_HANDLE_VALUE {
            return Err(last_error("creating OS-restricted named pipe"));
        }
        Ok(OwnedHandle(handle))
    }

    fn connect_server_pipe(handle: Handle) -> Result<(), String> {
        if unsafe { ConnectNamedPipe(handle, null_mut()) } != 0 {
            return Ok(());
        }
        let error = io::Error::last_os_error();
        if error.raw_os_error() == Some(ERROR_PIPE_CONNECTED as i32) {
            Ok(())
        } else {
            Err(format!("accepting named-pipe client failed: {error}"))
        }
    }

    fn connect_client_pipe(
        endpoint: &OsStr,
        desired_access: Dword,
        timeout: Duration,
    ) -> Result<OwnedHandle, String> {
        let endpoint = wide_pipe_endpoint(endpoint)?;
        let deadline = Instant::now() + timeout;
        loop {
            let raw = unsafe {
                CreateFileW(
                    endpoint.as_ptr(),
                    desired_access,
                    0,
                    null_mut(),
                    OPEN_EXISTING,
                    0,
                    null_mut(),
                )
            };
            if raw != INVALID_HANDLE_VALUE {
                return Ok(OwnedHandle(raw));
            }
            let error = io::Error::last_os_error();
            let code = error.raw_os_error().unwrap_or_default() as Dword;
            if Instant::now() >= deadline
                || (code != ERROR_PIPE_BUSY && code != ERROR_FILE_NOT_FOUND)
            {
                return Err(format!("connecting named pipe failed: {error}"));
            }
            unsafe {
                WaitNamedPipeW(endpoint.as_ptr(), 50);
            }
            thread::sleep(Duration::from_millis(10));
        }
    }

    fn proxy_one_frame(public: OwnedHandle, backend_endpoint: &OsStr) -> Result<(), String> {
        let request = read_frame_or_eof(public.0)?;
        if request.is_empty() {
            unsafe {
                DisconnectNamedPipe(public.0);
            }
            return Ok(());
        }
        let backend = connect_client_pipe(
            backend_endpoint,
            GENERIC_READ | GENERIC_WRITE,
            Duration::from_secs(5),
        )?;
        write_all_handle(backend.0, &request)?;
        let response = read_frame_or_eof(backend.0)?;
        if !response.is_empty() {
            write_all_handle(public.0, &response)?;
            unsafe {
                FlushFileBuffers(public.0);
            }
        }
        unsafe {
            DisconnectNamedPipe(public.0);
        }
        Ok(())
    }

    fn read_frame_or_eof(handle: Handle) -> Result<Vec<u8>, String> {
        let mut frame = Vec::new();
        let mut buffer = [0u8; 8192];
        loop {
            let mut read = 0;
            if unsafe {
                ReadFile(
                    handle,
                    buffer.as_mut_ptr() as *mut c_void,
                    buffer.len() as Dword,
                    &mut read,
                    null_mut(),
                )
            } == 0
            {
                let error = io::Error::last_os_error();
                if error.raw_os_error() == Some(ERROR_BROKEN_PIPE as i32) {
                    return Ok(frame);
                }
                return Err(format!("reading named-pipe frame failed: {error}"));
            }
            if read == 0 {
                return Ok(frame);
            }
            frame.extend_from_slice(&buffer[..read as usize]);
            if frame.len() > MAX_PROXY_FRAME_BYTES {
                return Err("named-pipe proxy frame exceeds the IPC limit".into());
            }
            if let Some(newline) = frame.iter().position(|byte| *byte == b'\n') {
                if newline + 1 != frame.len() {
                    return Err("named-pipe proxy accepts exactly one frame per connection".into());
                }
                return Ok(frame);
            }
        }
    }

    fn write_all_handle(handle: Handle, mut bytes: &[u8]) -> Result<(), String> {
        while !bytes.is_empty() {
            let mut written = 0;
            if unsafe {
                WriteFile(
                    handle,
                    bytes.as_ptr() as *const c_void,
                    bytes.len().min(Dword::MAX as usize) as Dword,
                    &mut written,
                    null_mut(),
                )
            } == 0
            {
                return Err(last_error("writing named-pipe frame"));
            }
            if written == 0 {
                return Err("writing named-pipe frame made no progress".into());
            }
            bytes = &bytes[written as usize..];
        }
        Ok(())
    }

    fn validate_pipe_endpoint(endpoint: &OsStr) -> Result<(), String> {
        let value = endpoint.to_string_lossy();
        if !value.starts_with(r"\\.\pipe\") || value.len() <= r"\\.\pipe\".len() {
            return Err("named-pipe endpoint must use the local \\\\.\\pipe\\ namespace".into());
        }
        if value.encode_utf16().count() >= 256 {
            return Err("named-pipe endpoint exceeds the Windows name limit".into());
        }
        Ok(())
    }

    fn wide_pipe_endpoint(endpoint: &OsStr) -> Result<Vec<u16>, String> {
        validate_pipe_endpoint(endpoint)?;
        let mut wide: Vec<u16> = endpoint.encode_wide().collect();
        if wide.iter().any(|unit| *unit == 0) {
            return Err("named-pipe endpoint contains a NUL".into());
        }
        wide.push(0);
        Ok(wide)
    }

    fn open_target(
        path: &OsStr,
        kind: TargetKind,
        desired_access: Dword,
    ) -> Result<OwnedHandle, String> {
        let mut wide: Vec<u16> = path.encode_wide().collect();
        if wide.is_empty() || wide.iter().any(|unit| *unit == 0) {
            return Err("target path is empty or contains a NUL".into());
        }
        wide.push(0);
        let raw = unsafe {
            CreateFileW(
                wide.as_ptr(),
                desired_access,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                null_mut(),
                OPEN_EXISTING,
                FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS,
                null_mut(),
            )
        };
        if raw == INVALID_HANDLE_VALUE {
            return Err(last_error("opening ACL target"));
        }
        let handle = OwnedHandle(raw);
        let mut info: FileAttributeTagInfo = unsafe { zeroed() };
        if unsafe {
            GetFileInformationByHandleEx(
                handle.0,
                FILE_ATTRIBUTE_TAG_INFO_CLASS,
                &mut info as *mut _ as *mut c_void,
                size_of::<FileAttributeTagInfo>() as Dword,
            )
        } == 0
        {
            return Err(last_error("inspecting ACL target"));
        }
        if info.file_attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err("ACL target is a reparse point".into());
        }
        let is_directory = info.file_attributes & FILE_ATTRIBUTE_DIRECTORY != 0;
        if is_directory != matches!(kind, TargetKind::Directory) {
            return Err("ACL target kind does not match the requested kind".into());
        }
        Ok(handle)
    }

    fn current_user_sid() -> Result<Vec<u8>, String> {
        let mut token = null_mut();
        if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) } == 0 {
            return Err(last_error("opening process token"));
        }
        let token = OwnedHandle(token);
        let mut required = 0;
        unsafe {
            GetTokenInformation(token.0, 1, null_mut(), 0, &mut required);
        }
        if required == 0 {
            return Err(last_error("sizing process token user"));
        }
        let mut token_user = vec![0u8; required as usize];
        if unsafe {
            GetTokenInformation(
                token.0,
                1,
                token_user.as_mut_ptr() as *mut c_void,
                required,
                &mut required,
            )
        } == 0
        {
            return Err(last_error("reading process token user"));
        }
        let source = unsafe {
            (token_user.as_ptr() as *const TokenUser)
                .read_unaligned()
                .user
                .sid
        };
        copy_sid(source)
    }

    fn local_system_sid() -> Result<Vec<u8>, String> {
        let mut sid = vec![0u8; SECURITY_MAX_SID_SIZE];
        let mut length = sid.len() as Dword;
        if unsafe {
            CreateWellKnownSid(
                WIN_LOCAL_SYSTEM_SID,
                null_mut(),
                sid.as_mut_ptr() as Psid,
                &mut length,
            )
        } == 0
        {
            return Err(last_error("creating Local System SID"));
        }
        sid.truncate(length as usize);
        Ok(sid)
    }

    fn copy_sid(source: Psid) -> Result<Vec<u8>, String> {
        let length = unsafe { GetLengthSid(source) };
        if length == 0 {
            return Err(last_error("measuring user SID"));
        }
        let mut sid = vec![0u8; length as usize];
        if unsafe { CopySid(length, sid.as_mut_ptr() as Psid, source) } == 0 {
            return Err(last_error("copying user SID"));
        }
        Ok(sid)
    }

    fn apply_acl(handle: Handle, kind: TargetKind, user: Psid, system: Psid) -> Result<(), String> {
        let mut storage = build_acl(user, system, ace_flags(kind))?;
        let acl = storage.as_mut_ptr() as *mut Acl;
        let status = unsafe {
            SetSecurityInfo(
                handle,
                SE_FILE_OBJECT,
                DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
                null_mut(),
                null_mut(),
                acl,
                null_mut(),
            )
        };
        if status != 0 {
            return Err(format!(
                "setting protected DACL failed with Windows error {status}"
            ));
        }
        Ok(())
    }

    fn build_acl(user: Psid, system: Psid, flags: u8) -> Result<Vec<u32>, String> {
        let user_length = unsafe { GetLengthSid(user) } as usize;
        let system_length = unsafe { GetLengthSid(system) } as usize;
        let fixed_ace = size_of::<AccessAllowedAce>() - size_of::<Dword>();
        let bytes = size_of::<Acl>() + fixed_ace * 2 + user_length + system_length;
        let mut storage = vec![0u32; bytes.div_ceil(size_of::<u32>())];
        let acl = storage.as_mut_ptr() as *mut Acl;
        if unsafe { InitializeAcl(acl, bytes as Dword, ACL_REVISION) } == 0 {
            return Err(last_error("initializing protected DACL"));
        }
        if unsafe {
            AddAccessAllowedAceEx(acl, ACL_REVISION, flags as Dword, FILE_ALL_ACCESS, user)
        } == 0
        {
            return Err(last_error("adding current-user DACL entry"));
        }
        if unsafe {
            AddAccessAllowedAceEx(acl, ACL_REVISION, flags as Dword, FILE_ALL_ACCESS, system)
        } == 0
        {
            return Err(last_error("adding Local System DACL entry"));
        }
        Ok(storage)
    }

    fn verify_owner(handle: Handle, user: Psid) -> Result<(), String> {
        with_security_info(handle, SE_FILE_OBJECT, |owner, _, _| {
            if owner.is_null() || unsafe { EqualSid(owner, user) } == 0 {
                return Err("ACL target owner is not the current user".into());
            }
            Ok(())
        })
    }

    fn verify_acl(
        handle: Handle,
        kind: TargetKind,
        user: Psid,
        system: Psid,
    ) -> Result<(), String> {
        verify_acl_for_object(handle, kind, user, system, SE_FILE_OBJECT)
    }

    fn verify_acl_for_object(
        handle: Handle,
        kind: TargetKind,
        user: Psid,
        system: Psid,
        object_type: Dword,
    ) -> Result<(), String> {
        with_security_info(handle, object_type, |owner, dacl, descriptor| {
            if owner.is_null() || unsafe { EqualSid(owner, user) } == 0 {
                return Err("target owner is not the current user".into());
            }
            let mut control = 0u16;
            let mut revision = 0u32;
            if unsafe { GetSecurityDescriptorControl(descriptor, &mut control, &mut revision) } == 0
            {
                return Err(last_error("reading security descriptor control"));
            }
            if control & SE_DACL_PROTECTED == 0 {
                return Err("DACL is not protected from inheritance".into());
            }
            if dacl.is_null() || unsafe { (*dacl).ace_count } != 2 {
                return Err("DACL does not contain exactly two entries".into());
            }
            let expected_flags = ace_flags(kind);
            let mut saw_user = false;
            let mut saw_system = false;
            for index in 0..2u32 {
                let mut raw_ace = null_mut();
                if unsafe { GetAce(dacl, index, &mut raw_ace) } == 0 {
                    return Err(last_error("reading DACL entry"));
                }
                let ace = unsafe { &*(raw_ace as *const AccessAllowedAce) };
                if ace.header.ace_type != ACCESS_ALLOWED_ACE_TYPE
                    || ace.header.ace_flags != expected_flags
                    || ace.mask != FILE_ALL_ACCESS
                {
                    return Err("DACL contains an unexpected access entry".into());
                }
                let sid = &ace.sid_start as *const Dword as Psid;
                if unsafe { EqualSid(sid, user) } != 0 {
                    if saw_user {
                        return Err("DACL repeats the current-user entry".into());
                    }
                    saw_user = true;
                } else if unsafe { EqualSid(sid, system) } != 0 {
                    if saw_system {
                        return Err("DACL repeats the Local System entry".into());
                    }
                    saw_system = true;
                } else {
                    return Err("DACL grants access to an unexpected principal".into());
                }
            }
            if !saw_user || !saw_system {
                return Err("DACL is missing a required principal".into());
            }
            Ok(())
        })
    }

    fn with_security_info<T>(
        handle: Handle,
        object_type: Dword,
        inspect: impl FnOnce(Psid, *mut Acl, SecurityDescriptor) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut owner = null_mut();
        let mut dacl = null_mut();
        let mut descriptor = null_mut();
        let status = unsafe {
            GetSecurityInfo(
                handle,
                object_type,
                OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
                &mut owner,
                null_mut(),
                &mut dacl,
                null_mut(),
                &mut descriptor,
            )
        };
        if status != 0 {
            return Err(format!(
                "reading security descriptor failed with Windows error {status}"
            ));
        }
        if descriptor.is_null() {
            return Err("Windows returned an empty security descriptor".into());
        }
        let memory = LocalMemory(descriptor);
        inspect(owner, dacl, memory.0)
    }

    fn ace_flags(kind: TargetKind) -> u8 {
        match kind {
            TargetKind::Directory => OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE,
            TargetKind::File => 0,
            TargetKind::Pipe => 0,
        }
    }

    fn last_error(context: &str) -> String {
        format!("{context}: {}", io::Error::last_os_error())
    }
}

#[cfg(target_os = "windows")]
fn main() {
    if let Err(error) = windows::run() {
        eprintln!("{error}");
        std::process::exit(2);
    }
}
