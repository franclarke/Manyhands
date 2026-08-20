export const DEFAULT_ATTEMPT_ROOT: string;

export interface ViajeEnFamiliaAttempt {
  readonly attempt: number;
  readonly label: string;
  readonly attemptDirectory: string;
  readonly repoDirectory: string;
  readonly daemonStateDirectory: string;
  readonly workspaceName: string;
  readonly files: readonly string[];
}

export function createViajeEnFamiliaAttempt(options: {
  readonly attempt: number;
  readonly baseDirectory?: string;
}): Promise<ViajeEnFamiliaAttempt>;
