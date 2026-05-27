export class RunNotFoundError extends Error {
  constructor(id: string) {
    super(`Run not found: ${id}`);
    this.name = "RunNotFoundError";
  }
}

export class RunValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunValidationError";
  }
}

export class RunLifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunLifecycleError";
  }
}
