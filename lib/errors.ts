export class NotConfiguredError extends Error {
  readonly service: string;
  readonly envVar: string;

  constructor(args: { service: string; envVar: string }) {
    super(
      `${args.service} is not configured — see BLOCKERS.md and set ${args.envVar}`,
    );
    this.name = "NotConfiguredError";
    this.service = args.service;
    this.envVar = args.envVar;
  }
}
