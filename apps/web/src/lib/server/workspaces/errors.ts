export class WorkspaceNotFoundError extends Error {
  constructor(id: string) {
    super(`Workspace not found: ${id}`);
    this.name = "WorkspaceNotFoundError";
  }
}

export class WorkspaceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceValidationError";
  }
}

export class WorkspaceConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceConflictError";
  }
}
