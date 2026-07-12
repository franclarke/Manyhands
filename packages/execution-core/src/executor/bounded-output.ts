/** Bounded diagnostic capture: preserve the newest actionable tail without retaining unbounded subprocess output. */
export class BoundedOutput {
  private value = "";
  private observed = 0;
  private wasTruncated = false;
  constructor(private readonly maxBytes = 64 * 1024) {}

  append(chunk: string): void {
    this.observed += Buffer.byteLength(chunk, "utf8");
    this.value += chunk;
    while (Buffer.byteLength(this.value, "utf8") > this.maxBytes) {
      this.value = this.value.slice(Math.max(1, this.value.length - Math.ceil(this.value.length * 0.9)));
      this.wasTruncated = true;
    }
  }
  text(): string { return this.wasTruncated ? `[output truncated; ${this.observed} bytes observed]\n${this.value}` : this.value; }
  get bytesObserved(): number { return this.observed; }
  get truncated(): boolean { return this.wasTruncated; }
}
