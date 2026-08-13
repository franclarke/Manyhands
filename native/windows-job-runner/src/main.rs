#![cfg_attr(not(target_os = "windows"), allow(dead_code))]

#[cfg(not(target_os = "windows"))]
fn main() {
    eprintln!("manyhands-windows-job-runner is supported only on Windows");
    std::process::exit(1);
}

#[cfg(target_os = "windows")]
mod windows {
    use std::ffi::{c_void, OsStr};
    use std::fs::{self, OpenOptions};
    use std::io::{self, Read, Write};
    use std::mem::{size_of, zeroed};
    use std::os::windows::ffi::OsStrExt;
    use std::path::{Path, PathBuf};
    use std::ptr::null_mut;
    use std::thread;
    use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

    type Bool = i32;
    type Dword = u32;
    type Handle = *mut c_void;
    type Lpwstr = *mut u16;
    type Lpcwstr = *const u16;
    type SizeT = usize;
    type UlongPtr = usize;

    const FALSE: Bool = 0;
    const TRUE: Bool = 1;
    const INVALID_HANDLE_VALUE: Handle = -1isize as Handle;
    const ERROR_FILE_NOT_FOUND: Dword = 2;
    const ERROR_ALREADY_EXISTS: Dword = 183;
    const ERROR_INVALID_PARAMETER: Dword = 87;
    const ERROR_ACCESS_DENIED: Dword = 5;
    const PROCESS_QUERY_LIMITED_INFORMATION: Dword = 0x1000;
    const SYNCHRONIZE: Dword = 0x0010_0000;
    const JOB_OBJECT_TERMINATE: Dword = 0x0008;
    const JOB_OBJECT_QUERY: Dword = 0x0004;
    const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: Dword = 0x0000_2000;
    const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS: Dword = 9;
    const JOB_OBJECT_BASIC_ACCOUNTING_INFORMATION_CLASS: Dword = 1;
    const CREATE_SUSPENDED: Dword = 0x0000_0004;
    const CREATE_UNICODE_ENVIRONMENT: Dword = 0x0000_0400;
    const STARTF_USESTDHANDLES: Dword = 0x0000_0100;
    const GENERIC_READ: Dword = 0x8000_0000;
    const GENERIC_WRITE: Dword = 0x4000_0000;
    const FILE_SHARE_READ: Dword = 0x0000_0001;
    const FILE_SHARE_WRITE: Dword = 0x0000_0002;
    const CREATE_ALWAYS: Dword = 2;
    const OPEN_EXISTING: Dword = 3;
    const FILE_ATTRIBUTE_NORMAL: Dword = 0x0000_0080;
    const INFINITE: Dword = 0xffff_ffff;
    const WAIT_OBJECT_0: Dword = 0;

    #[repr(C)]
    struct SecurityAttributes {
        length: Dword,
        security_descriptor: *mut c_void,
        inherit_handle: Bool,
    }

    #[repr(C)]
    struct StartupInfoW {
        cb: Dword,
        reserved: Lpwstr,
        desktop: Lpwstr,
        title: Lpwstr,
        x: Dword,
        y: Dword,
        x_size: Dword,
        y_size: Dword,
        x_count_chars: Dword,
        y_count_chars: Dword,
        fill_attribute: Dword,
        flags: Dword,
        show_window: u16,
        reserved2_length: u16,
        reserved2: *mut u8,
        std_input: Handle,
        std_output: Handle,
        std_error: Handle,
    }

    #[repr(C)]
    struct ProcessInformation {
        process: Handle,
        thread: Handle,
        process_id: Dword,
        thread_id: Dword,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct FileTime {
        low: Dword,
        high: Dword,
    }

    #[repr(C)]
    struct JobObjectBasicLimitInformation {
        per_process_user_time_limit: i64,
        per_job_user_time_limit: i64,
        limit_flags: Dword,
        minimum_working_set_size: SizeT,
        maximum_working_set_size: SizeT,
        active_process_limit: Dword,
        affinity: UlongPtr,
        priority_class: Dword,
        scheduling_class: Dword,
    }

    #[repr(C)]
    struct IoCounters {
        read_operation_count: u64,
        write_operation_count: u64,
        other_operation_count: u64,
        read_transfer_count: u64,
        write_transfer_count: u64,
        other_transfer_count: u64,
    }

    #[repr(C)]
    struct JobObjectExtendedLimitInformation {
        basic_limit_information: JobObjectBasicLimitInformation,
        io_info: IoCounters,
        process_memory_limit: SizeT,
        job_memory_limit: SizeT,
        peak_process_memory_used: SizeT,
        peak_job_memory_used: SizeT,
    }

    #[repr(C)]
    struct JobObjectBasicAccountingInformation {
        total_user_time: i64,
        total_kernel_time: i64,
        this_period_total_user_time: i64,
        this_period_total_kernel_time: i64,
        total_page_fault_count: Dword,
        total_processes: Dword,
        active_processes: Dword,
        total_terminated_processes: Dword,
    }

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn CreateJobObjectW(attributes: *mut SecurityAttributes, name: Lpcwstr) -> Handle;
        fn OpenJobObjectW(access: Dword, inherit: Bool, name: Lpcwstr) -> Handle;
        fn SetInformationJobObject(
            job: Handle,
            class: Dword,
            info: *const c_void,
            length: Dword,
        ) -> Bool;
        fn AssignProcessToJobObject(job: Handle, process: Handle) -> Bool;
        fn IsProcessInJob(process: Handle, job: Handle, result: *mut Bool) -> Bool;
        fn TerminateJobObject(job: Handle, exit_code: u32) -> Bool;
        fn QueryInformationJobObject(
            job: Handle,
            class: Dword,
            info: *mut c_void,
            length: Dword,
            returned_length: *mut Dword,
        ) -> Bool;
        fn GetCurrentProcess() -> Handle;
        fn GetCurrentProcessId() -> Dword;
        fn CreateProcessW(
            application_name: Lpcwstr,
            command_line: Lpwstr,
            process_attributes: *mut SecurityAttributes,
            thread_attributes: *mut SecurityAttributes,
            inherit_handles: Bool,
            creation_flags: Dword,
            environment: *mut c_void,
            current_directory: Lpcwstr,
            startup_info: *mut StartupInfoW,
            process_information: *mut ProcessInformation,
        ) -> Bool;
        fn ResumeThread(thread: Handle) -> Dword;
        fn WaitForSingleObject(handle: Handle, milliseconds: Dword) -> Dword;
        fn GetExitCodeProcess(process: Handle, exit_code: *mut Dword) -> Bool;
        fn GetProcessTimes(
            process: Handle,
            creation: *mut FileTime,
            exit: *mut FileTime,
            kernel: *mut FileTime,
            user: *mut FileTime,
        ) -> Bool;
        fn OpenProcess(access: Dword, inherit: Bool, process_id: Dword) -> Handle;
        fn CreateFileW(
            file_name: Lpcwstr,
            desired_access: Dword,
            share_mode: Dword,
            security_attributes: *mut SecurityAttributes,
            creation_disposition: Dword,
            flags: Dword,
            template: Handle,
        ) -> Handle;
        fn CloseHandle(handle: Handle) -> Bool;
        fn GetLastError() -> Dword;
        fn ExitProcess(exit_code: u32) -> !;
    }

    struct OwnedHandle(Handle);

    impl OwnedHandle {
        fn new(handle: Handle, context: &str) -> io::Result<Self> {
            if handle.is_null() || handle == INVALID_HANDLE_VALUE {
                Err(last_error(context))
            } else {
                Ok(Self(handle))
            }
        }

        fn raw(&self) -> Handle {
            self.0
        }
    }

    impl Drop for OwnedHandle {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }

    struct Request {
        receipt_directory: String,
        effect_id: String,
        input_digest: String,
        daemon_epoch: String,
        attempt_id: String,
        supervisor_nonce: String,
        job_name: String,
        cwd: String,
        executable: String,
        stdout_path: String,
        stderr_path: String,
        argv: Vec<String>,
        env: Vec<(String, String)>,
    }

    struct Cursor<'a> {
        bytes: &'a [u8],
        offset: usize,
    }

    impl<'a> Cursor<'a> {
        fn u32(&mut self) -> io::Result<u32> {
            let end = self.offset.checked_add(4).ok_or_else(invalid_request)?;
            let raw: [u8; 4] = self
                .bytes
                .get(self.offset..end)
                .ok_or_else(invalid_request)?
                .try_into()
                .map_err(|_| invalid_request())?;
            self.offset = end;
            Ok(u32::from_le_bytes(raw))
        }

        fn string(&mut self) -> io::Result<String> {
            let length = self.u32()? as usize;
            if length > 1024 * 1024 {
                return Err(invalid_request());
            }
            let end = self
                .offset
                .checked_add(length)
                .ok_or_else(invalid_request)?;
            let value = std::str::from_utf8(
                self.bytes
                    .get(self.offset..end)
                    .ok_or_else(invalid_request)?,
            )
            .map_err(|_| invalid_request())?
            .to_owned();
            self.offset = end;
            if value.contains('\0') {
                return Err(invalid_request());
            }
            Ok(value)
        }
    }

    pub fn main() {
        let args: Vec<String> = std::env::args().collect();
        let result = match args.get(1).map(String::as_str) {
            Some("run") if args.len() == 3 => run(Path::new(&args[2])),
            Some("probe") if args.len() == 4 => probe_command(&args[2], &args[3]),
            Some("terminate") if args.len() == 7 => {
                terminate_command(&args[2], &args[3], &args[4], &args[5], &args[6])
            }
            _ => Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "invalid helper command",
            )),
        };
        if let Err(error) = result {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }

    fn run(request_path: &Path) -> io::Result<()> {
        let request = parse_request(&fs::read(request_path)?)?;
        fs::create_dir_all(&request.receipt_directory)?;
        let custodian_job = create_kill_on_close_job(&custodian_job_name(&request.job_name))?;
        let provider_job = create_kill_on_close_job(&provider_job_name(&request.job_name))?;

        let stdout = create_inheritable_file(&request.stdout_path, GENERIC_WRITE, CREATE_ALWAYS)?;
        let stderr = create_inheritable_file(&request.stderr_path, GENERIC_WRITE, CREATE_ALWAYS)?;
        let null_input = create_inheritable_file("NUL", GENERIC_READ, OPEN_EXISTING)?;

        // The helper first joins the custodian Job. The provider inherits that
        // kernel custody and is then placed in a nested provider Job while still
        // suspended. This lets the helper reap the provider tree and verify it
        // empty before publishing final, while kill-on-close still covers a
        // helper/daemon crash.
        check_bool(
            unsafe { AssignProcessToJobObject(custodian_job.raw(), GetCurrentProcess()) },
            "AssignProcessToJobObject(custodian)",
        )?;

        let application = wide(&request.executable);
        let mut command_line = wide(&build_command_line(&request.executable, &request.argv));
        let cwd = wide(&request.cwd);
        let mut environment = environment_block(&request.env)?;
        let mut startup: StartupInfoW = unsafe { zeroed() };
        startup.cb = size_of::<StartupInfoW>() as Dword;
        startup.flags = STARTF_USESTDHANDLES;
        startup.std_input = null_input.raw();
        startup.std_output = stdout.raw();
        startup.std_error = stderr.raw();
        let mut process_info: ProcessInformation = unsafe { zeroed() };
        let created = unsafe {
            CreateProcessW(
                application.as_ptr(),
                command_line.as_mut_ptr(),
                null_mut(),
                null_mut(),
                TRUE,
                CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT,
                environment.as_mut_ptr() as *mut c_void,
                cwd.as_ptr(),
                &mut startup,
                &mut process_info,
            )
        };
        if created == FALSE {
            let error = last_error("CreateProcessW");
            write_failure_without_start(&request, &error.to_string())?;
            println!("FAILED");
            io::stdout().flush()?;
            unsafe { ExitProcess(1) };
        }
        let child_process = OwnedHandle::new(process_info.process, "provider process handle")?;
        let child_thread = OwnedHandle::new(process_info.thread, "provider thread handle")?;
        require_process_in_job(
            child_process.raw(),
            custodian_job.raw(),
            "provider did not inherit custodian Job",
        )?;
        check_bool(
            unsafe { AssignProcessToJobObject(provider_job.raw(), child_process.raw()) },
            "AssignProcessToJobObject(provider)",
        )?;
        require_process_in_job(
            child_process.raw(),
            provider_job.raw(),
            "provider did not join provider Job",
        )?;
        let creation_identity = process_creation_identity(child_process.raw())?;
        let custodian_creation_identity =
            process_creation_identity(unsafe { GetCurrentProcess() })?;
        let common = receipt_common(
            &request,
            process_info.process_id,
            &creation_identity,
            unsafe { GetCurrentProcessId() },
            &custodian_creation_identity,
        );
        let started_material = format!(
            "{{{common},\"phase\":\"started\",\"startedAtEpochMs\":{}}}",
            epoch_millis(),
        );
        let started_checksum = receipt_checksum(&started_material);
        write_immutable_json(
            &Path::new(&request.receipt_directory).join("started.json"),
            &receipt_with_checksum(&started_material),
        )?;
        println!("STARTED");
        io::stdout().flush()?;

        let custodian_job_for_sentinel = custodian_job.raw() as usize;
        let provider_job_for_sentinel = provider_job.raw() as usize;
        thread::spawn(move || {
            let mut byte = [0u8; 1];
            loop {
                match io::stdin().read(&mut byte) {
                    Ok(0) | Err(_) => unsafe {
                        TerminateJobObject(provider_job_for_sentinel as Handle, 0x4d48_0001);
                        TerminateJobObject(custodian_job_for_sentinel as Handle, 0x4d48_0001);
                        ExitProcess(1);
                    },
                    Ok(_) => {}
                }
            }
        });

        let resume_result = unsafe { ResumeThread(child_thread.raw()) };
        if resume_result == u32::MAX {
            return Err(last_error("ResumeThread"));
        }
        if unsafe { WaitForSingleObject(child_process.raw(), INFINITE) } != WAIT_OBJECT_0 {
            return Err(last_error("WaitForSingleObject"));
        }
        let mut exit_code = 0u32;
        check_bool(
            unsafe { GetExitCodeProcess(child_process.raw(), &mut exit_code) },
            "GetExitCodeProcess",
        )?;
        terminate_job_and_wait_empty(provider_job.raw(), 0x4d48_0003)?;
        let outcome = if exit_code == 0 {
            "succeeded"
        } else {
            "failed"
        };
        let final_material = format!(
            "{{{common},\"phase\":\"final\",\"outcome\":{},\"exitCode\":{exit_code},\"completedAtEpochMs\":{},\"startedReceiptChecksum\":{}}}",
            json(outcome), epoch_millis(), json(&started_checksum),
        );
        write_immutable_json(
            &Path::new(&request.receipt_directory).join("final.json"),
            &receipt_with_checksum(&final_material),
        )?;
        // Both receipt publication and provider-tree death are durable before
        // custody ends. Closing the custodian Job is now only the crash backstop.
        unsafe { ExitProcess(0) }
    }

    fn parse_request(bytes: &[u8]) -> io::Result<Request> {
        if bytes.get(..6) != Some(b"MHJR1\0") {
            return Err(invalid_request());
        }
        let mut cursor = Cursor { bytes, offset: 6 };
        let receipt_directory = cursor.string()?;
        let effect_id = cursor.string()?;
        let input_digest = cursor.string()?;
        let daemon_epoch = cursor.string()?;
        let attempt_id = cursor.string()?;
        let supervisor_nonce = cursor.string()?;
        let job_name = cursor.string()?;
        let cwd = cursor.string()?;
        let executable = cursor.string()?;
        let stdout_path = cursor.string()?;
        let stderr_path = cursor.string()?;
        let argc = cursor.u32()? as usize;
        if argc > 4096 {
            return Err(invalid_request());
        }
        let mut argv = Vec::with_capacity(argc);
        for _ in 0..argc {
            argv.push(cursor.string()?);
        }
        let envc = cursor.u32()? as usize;
        if envc > 4096 {
            return Err(invalid_request());
        }
        let mut env = Vec::with_capacity(envc);
        for _ in 0..envc {
            let key = cursor.string()?;
            let value = cursor.string()?;
            if key.is_empty() || key.contains('=') {
                return Err(invalid_request());
            }
            env.push((key, value));
        }
        if cursor.offset != bytes.len()
            || receipt_directory.is_empty()
            || effect_id.is_empty()
            || input_digest.is_empty()
            || daemon_epoch.is_empty()
            || supervisor_nonce.is_empty()
            || job_name.is_empty()
            || cwd.is_empty()
            || executable.is_empty()
        {
            return Err(invalid_request());
        }
        Ok(Request {
            receipt_directory,
            effect_id,
            input_digest,
            daemon_epoch,
            attempt_id,
            supervisor_nonce,
            job_name,
            cwd,
            executable,
            stdout_path,
            stderr_path,
            argv,
            env,
        })
    }

    fn write_failure_without_start(request: &Request, reason: &str) -> io::Result<()> {
        // A provider was never created, so there is deliberately no started
        // receipt. This diagnostic is not accepted as a terminal supervisor
        // receipt by the TypeScript boundary.
        write_immutable_json(
            &Path::new(&request.receipt_directory).join("spawn-failure.json"),
            &format!(
                "{{\"schemaVersion\":1,\"effectId\":{},\"reason\":{}}}\n",
                json(&request.effect_id),
                json(reason)
            ),
        )
    }

    fn receipt_common(
        request: &Request,
        pid: Dword,
        creation_identity: &str,
        custodian_pid: Dword,
        custodian_creation_identity: &str,
    ) -> String {
        format!(
            "\"schemaVersion\":1,\"effectId\":{},\"inputDigest\":{},\"daemonEpoch\":{},{}\"processIdentity\":{{\"pid\":{pid},\"creationIdentity\":{},\"supervisorNonce\":{}}},\"custodianIdentity\":{{\"pid\":{custodian_pid},\"creationIdentity\":{},\"supervisorNonce\":{}}},\"platformOwnership\":{},\"stdoutPath\":{},\"stderrPath\":{}",
            json(&request.effect_id),
            json(&request.input_digest),
            json(&request.daemon_epoch),
            if request.attempt_id.is_empty() { String::new() } else { format!("\"attemptId\":{},", json(&request.attempt_id)) },
            json(creation_identity),
            json(&request.supervisor_nonce),
            json(custodian_creation_identity),
            json(&format!("{}:custodian", request.supervisor_nonce)),
            json(&request.job_name),
            json(&request.stdout_path),
            json(&request.stderr_path),
        )
    }

    fn probe_command(pid: &str, expected: &str) -> io::Result<()> {
        let pid = pid.parse::<u32>().map_err(|_| invalid_request())?;
        println!("{}", probe_identity(pid, expected));
        Ok(())
    }

    fn terminate_command(
        job_name: &str,
        provider_pid: &str,
        provider_expected: &str,
        custodian_pid: &str,
        custodian_expected: &str,
    ) -> io::Result<()> {
        let provider_pid = provider_pid.parse::<u32>().map_err(|_| invalid_request())?;
        let custodian_pid = custodian_pid
            .parse::<u32>()
            .map_err(|_| invalid_request())?;
        let custodian_job = open_job_if_present(&custodian_job_name(job_name))?;
        let provider_job = open_job_if_present(&provider_job_name(job_name))?;

        let (custodian_job, provider_job) = match (custodian_job, provider_job) {
            (Some(custodian_job), Some(provider_job)) => (custodian_job, provider_job),
            (None, None) => {
                // A custodian crash closes the final named Job handles. Recovery
                // may then converge only when the kernel can prove that neither
                // exact durable identity exists. PID reuse and access-denied
                // probes remain fail-closed and are never individually killed.
                let provider = probe_identity(provider_pid, provider_expected);
                let custodian = probe_identity(custodian_pid, custodian_expected);
                if provider == "dead" && custodian == "dead" {
                    return Ok(());
                }
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    format!(
                        "Job Objects are absent but durable identities are not provably dead: provider={provider}, custodian={custodian}"
                    ),
                ));
            }
            _ => {
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "only one durable Job Object remains; refusing partial termination",
                ));
            }
        };

        // The exact custodian creation identity is the live authority for these
        // named Jobs. A missing/reused PID fails closed; it never authorizes a
        // synthetic final receipt.
        let custodian =
            open_exact_process(custodian_pid, custodian_expected)?.ok_or_else(|| {
                io::Error::new(
                    io::ErrorKind::NotFound,
                    "custodian identity is no longer live",
                )
            })?;
        require_process_in_job(
            custodian.raw(),
            custodian_job.raw(),
            "custodian is not a member of its Job",
        )?;

        // A provider can race with natural exit. If its exact identity remains,
        // membership is revalidated before touching the Job; a reused PID is
        // ignored and is never individually terminated.
        if let Some(provider) = open_exact_process(provider_pid, provider_expected)? {
            require_process_in_job(
                provider.raw(),
                provider_job.raw(),
                "provider is not a member of its Job",
            )?;
        }

        // Terminating the outer Job atomically removes the original custodian
        // and its inherited provider tree before that custodian can race to
        // publish a normal final receipt for a controlled termination.
        check_bool(
            unsafe { TerminateJobObject(custodian_job.raw(), 0x4d48_0002) },
            "TerminateJobObject(custodian)",
        )?;
        wait_job_empty(custodian_job.raw())?;
        wait_job_empty(provider_job.raw())
    }

    fn probe_identity(pid: u32, expected: &str) -> &'static str {
        let raw =
            unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, FALSE, pid) };
        if raw.is_null() {
            let code = unsafe { GetLastError() };
            return if code == ERROR_INVALID_PARAMETER {
                "dead"
            } else if code == ERROR_ACCESS_DENIED {
                "unknown"
            } else {
                "unknown"
            };
        }
        let process = OwnedHandle(raw);
        match process_creation_identity(process.raw()) {
            Ok(identity) if identity == expected => "same",
            Ok(_) => "different",
            Err(_) => "unknown",
        }
    }

    fn process_creation_identity(process: Handle) -> io::Result<String> {
        let mut creation: FileTime = unsafe { zeroed() };
        let mut exit: FileTime = unsafe { zeroed() };
        let mut kernel: FileTime = unsafe { zeroed() };
        let mut user: FileTime = unsafe { zeroed() };
        check_bool(
            unsafe { GetProcessTimes(process, &mut creation, &mut exit, &mut kernel, &mut user) },
            "GetProcessTimes",
        )?;
        let ticks = ((creation.high as u64) << 32) | creation.low as u64;
        Ok(format!("windows-filetime:{ticks}"))
    }

    fn custodian_job_name(base: &str) -> String {
        format!("{base}-custodian")
    }

    fn provider_job_name(base: &str) -> String {
        format!("{base}-provider")
    }

    fn create_kill_on_close_job(name: &str) -> io::Result<OwnedHandle> {
        let name = wide(name);
        let raw = unsafe { CreateJobObjectW(null_mut(), name.as_ptr()) };
        let create_error = unsafe { GetLastError() };
        let job = OwnedHandle::new(raw, "CreateJobObjectW")?;
        if create_error == ERROR_ALREADY_EXISTS {
            return Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                "effect Job Object already exists",
            ));
        }
        let mut limits: JobObjectExtendedLimitInformation = unsafe { zeroed() };
        limits.basic_limit_information.limit_flags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        check_bool(
            unsafe {
                SetInformationJobObject(
                    job.raw(),
                    JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS,
                    &limits as *const _ as *const c_void,
                    size_of::<JobObjectExtendedLimitInformation>() as Dword,
                )
            },
            "SetInformationJobObject",
        )?;
        Ok(job)
    }

    fn open_job_if_present(name: &str) -> io::Result<Option<OwnedHandle>> {
        let name = wide(name);
        let raw = unsafe {
            OpenJobObjectW(
                JOB_OBJECT_TERMINATE | JOB_OBJECT_QUERY,
                FALSE,
                name.as_ptr(),
            )
        };
        if raw.is_null() {
            return if unsafe { GetLastError() } == ERROR_FILE_NOT_FOUND {
                Ok(None)
            } else {
                Err(last_error("OpenJobObjectW"))
            };
        }
        Ok(Some(OwnedHandle(raw)))
    }

    fn open_exact_process(pid: Dword, expected: &str) -> io::Result<Option<OwnedHandle>> {
        let raw =
            unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, FALSE, pid) };
        if raw.is_null() {
            let code = unsafe { GetLastError() };
            return if code == ERROR_INVALID_PARAMETER {
                Ok(None)
            } else {
                Err(last_error("OpenProcess(identity)"))
            };
        }
        let process = OwnedHandle(raw);
        if process_creation_identity(process.raw())? == expected {
            Ok(Some(process))
        } else {
            Ok(None)
        }
    }

    fn require_process_in_job(process: Handle, job: Handle, message: &str) -> io::Result<()> {
        let mut in_job = FALSE;
        check_bool(
            unsafe { IsProcessInJob(process, job, &mut in_job) },
            "IsProcessInJob",
        )?;
        if in_job == FALSE {
            Err(io::Error::new(io::ErrorKind::PermissionDenied, message))
        } else {
            Ok(())
        }
    }

    fn terminate_job_and_wait_empty(job: Handle, exit_code: u32) -> io::Result<()> {
        check_bool(
            unsafe { TerminateJobObject(job, exit_code) },
            "TerminateJobObject",
        )?;
        wait_job_empty(job)
    }

    fn wait_job_empty(job: Handle) -> io::Result<()> {
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            let mut accounting: JobObjectBasicAccountingInformation = unsafe { zeroed() };
            check_bool(
                unsafe {
                    QueryInformationJobObject(
                        job,
                        JOB_OBJECT_BASIC_ACCOUNTING_INFORMATION_CLASS,
                        &mut accounting as *mut _ as *mut c_void,
                        size_of::<JobObjectBasicAccountingInformation>() as Dword,
                        null_mut(),
                    )
                },
                "QueryInformationJobObject(accounting)",
            )?;
            if accounting.active_processes == 0 {
                return Ok(());
            }
            if Instant::now() >= deadline {
                return Err(io::Error::new(
                    io::ErrorKind::TimedOut,
                    "Job Object remained active after termination",
                ));
            }
            thread::sleep(Duration::from_millis(10));
        }
    }

    fn create_inheritable_file(
        path: &str,
        access: Dword,
        disposition: Dword,
    ) -> io::Result<OwnedHandle> {
        let path = wide(path);
        let mut attributes = SecurityAttributes {
            length: size_of::<SecurityAttributes>() as Dword,
            security_descriptor: null_mut(),
            inherit_handle: TRUE,
        };
        OwnedHandle::new(
            unsafe {
                CreateFileW(
                    path.as_ptr(),
                    access,
                    FILE_SHARE_READ | FILE_SHARE_WRITE,
                    &mut attributes,
                    disposition,
                    FILE_ATTRIBUTE_NORMAL,
                    null_mut(),
                )
            },
            "CreateFileW",
        )
    }

    fn environment_block(entries: &[(String, String)]) -> io::Result<Vec<u16>> {
        let mut sorted = entries.to_vec();
        sorted.sort_by(|left, right| left.0.to_lowercase().cmp(&right.0.to_lowercase()));
        let mut block = Vec::new();
        for (key, value) in sorted {
            if key.is_empty() || key.contains('=') || key.contains('\0') || value.contains('\0') {
                return Err(invalid_request());
            }
            block.extend(OsStr::new(&format!("{key}={value}")).encode_wide());
            block.push(0);
        }
        block.push(0);
        if entries.is_empty() {
            block.push(0);
        }
        Ok(block)
    }

    fn build_command_line(executable: &str, argv: &[String]) -> String {
        std::iter::once(executable)
            .chain(argv.iter().map(String::as_str))
            .map(quote_windows_argument)
            .collect::<Vec<_>>()
            .join(" ")
    }

    // Microsoft C runtime argv quoting. lpApplicationName remains explicit, so
    // this string is argument transport rather than shell evaluation.
    fn quote_windows_argument(argument: &str) -> String {
        if !argument.is_empty()
            && !argument
                .chars()
                .any(|ch| ch == ' ' || ch == '\t' || ch == '"')
        {
            return argument.to_owned();
        }
        let mut result = String::from("\"");
        let mut backslashes = 0usize;
        for ch in argument.chars() {
            if ch == '\\' {
                backslashes += 1;
            } else if ch == '"' {
                result.push_str(&"\\".repeat(backslashes * 2 + 1));
                result.push('"');
                backslashes = 0;
            } else {
                result.push_str(&"\\".repeat(backslashes));
                result.push(ch);
                backslashes = 0;
            }
        }
        result.push_str(&"\\".repeat(backslashes * 2));
        result.push('"');
        result
    }

    fn write_immutable_json(target: &Path, content: &str) -> io::Result<()> {
        let temporary = temporary_path(target);
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)?;
        file.write_all(content.as_bytes())?;
        file.sync_all()?;
        drop(file);
        // A hard-link is an atomic, exclusive publication on the same volume.
        // Unlike replacement rename, it cannot overwrite a durable observation.
        match fs::hard_link(&temporary, target) {
            Ok(()) => {
                fs::remove_file(&temporary)?;
                Ok(())
            }
            Err(error) => {
                let _ = fs::remove_file(&temporary);
                Err(error)
            }
        }
    }

    fn temporary_path(target: &Path) -> PathBuf {
        let mut value = target.as_os_str().to_os_string();
        value.push(format!(
            ".tmp.{}.{}",
            unsafe { GetCurrentProcessId() },
            epoch_millis()
        ));
        PathBuf::from(value)
    }

    fn receipt_with_checksum(material: &str) -> String {
        let checksum = receipt_checksum(material);
        format!(
            "{},\"receiptChecksum\":{}}}\n",
            &material[..material.len() - 1],
            json(&checksum)
        )
    }

    fn receipt_checksum(material: &str) -> String {
        format!("sha256:{}", sha256_hex(material.as_bytes()))
    }

    fn sha256_hex(input: &[u8]) -> String {
        const K: [u32; 64] = [
            0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
            0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
            0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
            0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
            0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
            0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
            0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
            0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
            0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
            0xc67178f2,
        ];
        let mut message = input.to_vec();
        let bit_length = (message.len() as u64).wrapping_mul(8);
        message.push(0x80);
        while message.len() % 64 != 56 {
            message.push(0);
        }
        message.extend_from_slice(&bit_length.to_be_bytes());

        let mut state = [
            0x6a09e667u32,
            0xbb67ae85,
            0x3c6ef372,
            0xa54ff53a,
            0x510e527f,
            0x9b05688c,
            0x1f83d9ab,
            0x5be0cd19,
        ];
        for chunk in message.chunks_exact(64) {
            let mut schedule = [0u32; 64];
            for (index, word) in schedule.iter_mut().take(16).enumerate() {
                *word = u32::from_be_bytes(chunk[index * 4..index * 4 + 4].try_into().unwrap());
            }
            for index in 16..64 {
                let s0 = schedule[index - 15].rotate_right(7)
                    ^ schedule[index - 15].rotate_right(18)
                    ^ (schedule[index - 15] >> 3);
                let s1 = schedule[index - 2].rotate_right(17)
                    ^ schedule[index - 2].rotate_right(19)
                    ^ (schedule[index - 2] >> 10);
                schedule[index] = schedule[index - 16]
                    .wrapping_add(s0)
                    .wrapping_add(schedule[index - 7])
                    .wrapping_add(s1);
            }
            let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut h] = state;
            for index in 0..64 {
                let sum1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
                let choose = (e & f) ^ ((!e) & g);
                let temp1 = h
                    .wrapping_add(sum1)
                    .wrapping_add(choose)
                    .wrapping_add(K[index])
                    .wrapping_add(schedule[index]);
                let sum0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
                let majority = (a & b) ^ (a & c) ^ (b & c);
                let temp2 = sum0.wrapping_add(majority);
                h = g;
                g = f;
                f = e;
                e = d.wrapping_add(temp1);
                d = c;
                c = b;
                b = a;
                a = temp1.wrapping_add(temp2);
            }
            state[0] = state[0].wrapping_add(a);
            state[1] = state[1].wrapping_add(b);
            state[2] = state[2].wrapping_add(c);
            state[3] = state[3].wrapping_add(d);
            state[4] = state[4].wrapping_add(e);
            state[5] = state[5].wrapping_add(f);
            state[6] = state[6].wrapping_add(g);
            state[7] = state[7].wrapping_add(h);
        }
        state.iter().map(|word| format!("{word:08x}")).collect()
    }

    fn json(value: &str) -> String {
        let mut result = String::from("\"");
        for ch in value.chars() {
            match ch {
                '"' => result.push_str("\\\""),
                '\\' => result.push_str("\\\\"),
                '\n' => result.push_str("\\n"),
                '\r' => result.push_str("\\r"),
                '\t' => result.push_str("\\t"),
                ch if ch < '\u{20}' => result.push_str(&format!("\\u{:04x}", ch as u32)),
                ch => result.push(ch),
            }
        }
        result.push('"');
        result
    }

    fn wide(value: &str) -> Vec<u16> {
        OsStr::new(value)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    fn epoch_millis() -> u128 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    }

    fn check_bool(result: Bool, context: &str) -> io::Result<()> {
        if result == FALSE {
            Err(last_error(context))
        } else {
            Ok(())
        }
    }

    fn last_error(context: &str) -> io::Error {
        let error = io::Error::last_os_error();
        io::Error::new(error.kind(), format!("{context}: {error}"))
    }

    fn invalid_request() -> io::Error {
        io::Error::new(
            io::ErrorKind::InvalidData,
            "invalid or oversized helper request",
        )
    }
}

#[cfg(target_os = "windows")]
fn main() {
    windows::main();
}
