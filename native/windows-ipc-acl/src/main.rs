#![cfg_attr(not(target_os = "windows"), allow(dead_code))]

#[cfg(not(target_os = "windows"))]
fn main() {
    eprintln!("manyhands-windows-ipc-acl is supported only on Windows");
    std::process::exit(1);
}

#[cfg(target_os = "windows")]
mod windows {
    use std::ffi::{c_void, OsStr, OsString};
    use std::io;
    use std::mem::{size_of, zeroed};
    use std::os::windows::ffi::OsStrExt;
    use std::ptr::null_mut;

    type Bool = i32;
    type Dword = u32;
    type Handle = *mut c_void;
    type Psid = *mut c_void;
    type SecurityDescriptor = *mut c_void;

    const INVALID_HANDLE_VALUE: Handle = -1isize as Handle;
    const TOKEN_QUERY: Dword = 0x0008;
    const READ_CONTROL: Dword = 0x0002_0000;
    const WRITE_DAC: Dword = 0x0004_0000;
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
    const OWNER_SECURITY_INFORMATION: Dword = 0x0000_0001;
    const DACL_SECURITY_INFORMATION: Dword = 0x0000_0004;
    const PROTECTED_DACL_SECURITY_INFORMATION: Dword = 0x8000_0000;
    const SE_DACL_PROTECTED: u16 = 0x1000;
    const ACL_REVISION: Dword = 2;
    const ACCESS_ALLOWED_ACE_TYPE: u8 = 0;
    const OBJECT_INHERIT_ACE: u8 = 0x01;
    const CONTAINER_INHERIT_ACE: u8 = 0x02;
    const FILE_ALL_ACCESS: Dword = 0x001f_01ff;
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
        fn CloseHandle(handle: Handle) -> Bool;
        fn GetCurrentProcess() -> Handle;
        fn GetFileInformationByHandleEx(
            file: Handle,
            info_class: i32,
            information: *mut c_void,
            size: Dword,
        ) -> Bool;
        fn LocalFree(memory: *mut c_void) -> *mut c_void;
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
    }

    struct OwnedHandle(Handle);

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
    }

    pub fn run() -> Result<(), String> {
        let mut args = std::env::args_os().skip(1);
        let operation = args.next().ok_or_else(usage)?;
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
        "usage: manyhands-windows-ipc-acl <apply|verify> <directory|file> <absolute-path>".into()
    }

    fn parse_kind(value: OsString) -> Result<TargetKind, String> {
        match value.to_str() {
            Some("directory") => Ok(TargetKind::Directory),
            Some("file") => Ok(TargetKind::File),
            _ => Err(usage()),
        }
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
        let user_length = unsafe { GetLengthSid(user) } as usize;
        let system_length = unsafe { GetLengthSid(system) } as usize;
        let fixed_ace = size_of::<AccessAllowedAce>() - size_of::<Dword>();
        let bytes = size_of::<Acl>() + fixed_ace * 2 + user_length + system_length;
        let mut storage = vec![0u32; bytes.div_ceil(size_of::<u32>())];
        let acl = storage.as_mut_ptr() as *mut Acl;
        if unsafe { InitializeAcl(acl, bytes as Dword, ACL_REVISION) } == 0 {
            return Err(last_error("initializing protected DACL"));
        }
        let flags = ace_flags(kind) as Dword;
        if unsafe { AddAccessAllowedAceEx(acl, ACL_REVISION, flags, FILE_ALL_ACCESS, user) } == 0 {
            return Err(last_error("adding current-user DACL entry"));
        }
        if unsafe { AddAccessAllowedAceEx(acl, ACL_REVISION, flags, FILE_ALL_ACCESS, system) } == 0
        {
            return Err(last_error("adding Local System DACL entry"));
        }
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

    fn verify_owner(handle: Handle, user: Psid) -> Result<(), String> {
        with_security_info(handle, |owner, _, _| {
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
        with_security_info(handle, |owner, dacl, descriptor| {
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
        inspect: impl FnOnce(Psid, *mut Acl, SecurityDescriptor) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut owner = null_mut();
        let mut dacl = null_mut();
        let mut descriptor = null_mut();
        let status = unsafe {
            GetSecurityInfo(
                handle,
                SE_FILE_OBJECT,
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
