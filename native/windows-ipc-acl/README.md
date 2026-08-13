# ManyHands Windows IPC ACL helper

This dependency-free helper protects and verifies the installation capability
directory and file without parsing localized command output. It opens the
target itself without following reparse points, requires the current user to be
the owner, and installs a protected DACL containing exactly two full-control
ACEs: the current user and Local System.

On Windows production startup, the helper also owns the public named pipe from
its first instance onward. Every instance is created with that same exact,
protected current-user plus Local System DACL. It proxies one authenticated IPC
frame at a time to an unadvertised Node-owned backend pipe; Node never creates
or advertises the public endpoint. A separate `verify-pipe` invocation inspects
the live public handle before the daemon reports `transportSecurity` as
`os_restricted`.

No binary is committed. Build the helper with `rustc` or Cargo and pass its
absolute path to `createWindowsIpcAclProtector` and
`createWindowsIpcAclVerifier`, and to the daemon as
`windowsPipeAclHelperPath`.
