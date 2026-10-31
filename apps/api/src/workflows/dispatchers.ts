import type { MandateCheckDispatcher } from "@entole/limit-order";
import type { Render } from "@renderinc/sdk";

type WorkflowsClient = { workflows: Pick<Render["workflows"], "startTask"> };

// Render accepts a start in well under a second; a hung call rejects so Svix retries the delivery.
const START_TIMEOUT_MS = 10_000;

// Starts the checkMandate task on Render and returns once Render accepted it; the task has retries.
// The event id goes with it so the finished check records which alert its run answered.
// The idempotency key makes a redelivered event return the run it already started, for 24 hours.
// Render scopes the key to a workflow version, so a deploy between delivery and retry can start a
// second run; one PayPal-Request-Id per capture makes that harmless.
export class RenderWorkflowDispatcher implements MandateCheckDispatcher {
  constructor(
    private readonly slug: string,
    private readonly client: WorkflowsClient,
    private readonly timeoutMs = START_TIMEOUT_MS,
  ) {}

  async dispatch(mandateId: string, cause: { eventId: string }): Promise<void> {
    await this.client.workflows.startTask(`${this.slug}/checkMandate`, [mandateId, cause.eventId], {
      signal: AbortSignal.timeout(this.timeoutMs),
      idempotencyKey: `c3:${cause.eventId}:${mandateId}`,
    });
  }
}

// Timer mode: runs the check in this process without waiting, so a webhook answers at once.
export class InProcessDispatcher implements MandateCheckDispatcher {
  constructor(private readonly check: (mandateId: string) => Promise<unknown>) {}

  async dispatch(mandateId: string, _cause: { eventId: string }): Promise<void> {
    void this.check(mandateId).catch((err: unknown) =>
      console.error(`check ${mandateId} failed`, err),
    );
  }
}
