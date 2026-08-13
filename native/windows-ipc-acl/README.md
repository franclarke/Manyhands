# ManyHands Windows IPC ACL helper

This dependency-free helper protects and verifies the installation capability
directory and file without parsing localized command output. It opens the
target itself without following reparse points, requires the current user to be
the owner, and installs a protected DACL containing exactly two full-control
ACEs: the current user and Local System.

No binary is committed. Build the helper with `rustc` or Cargo and pass its
absolute path to `createWindowsIpcAclProtector` and
`createWindowsIpcAclVerifier`.
