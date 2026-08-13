export interface RecoverableRunActor {
  recoverPendingEffects(): Promise<void>;
}

export interface RunActorRegistryOptions<
  TActor extends RecoverableRunActor,
  TRunAuthority
> {
  assertInstallationAuthority(): Promise<void>;
  claimRunAuthority(runId: string): Promise<TRunAuthority>;
  createActor(runId: string, authority: TRunAuthority): Promise<TActor> | TActor;
}

export class RunActorRegistry<
  TActor extends RecoverableRunActor,
  TRunAuthority
> {
  private readonly actors = new Map<string, Promise<TActor>>();

  constructor(
    private readonly options: RunActorRegistryOptions<TActor, TRunAuthority>
  ) {}

  getOrCreate(runId: string): Promise<TActor> {
    const existing = this.actors.get(runId);
    if (existing !== undefined) return existing;

    const pending = this.create(runId);
    this.actors.set(runId, pending);
    void pending.catch(() => {
      if (this.actors.get(runId) === pending) this.actors.delete(runId);
    });
    return pending;
  }

  private async create(runId: string): Promise<TActor> {
    await this.options.assertInstallationAuthority();
    const authority = await this.options.claimRunAuthority(runId);
    const actor = await this.options.createActor(runId, authority);
    await this.options.assertInstallationAuthority();
    await actor.recoverPendingEffects();
    return actor;
  }
}
