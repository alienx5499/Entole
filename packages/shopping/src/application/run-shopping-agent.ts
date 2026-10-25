import { type Mandate, type ProposeOrderDeps, proposeOrder } from "@entole/mandate";
import { formatUsd } from "@entole/shared-kernel";
import { AGENT_TOOLS, INVALID, isString, parseArgs, searchTool } from "./agent-tools.ts";
import type { AgentMessage, AgentModel, AgentToolCall } from "./ports.ts";

export type ShoppingAgentDeps = ProposeOrderDeps & { model: AgentModel };
export type AgentRunResult = {
  steps: number;
  outcome: "finished" | "step_limit" | "error";
  summary: string;
};

const systemPrompt = (m: Mandate): string => {
  const { item, maxUnitPrice, budget, allowedMerchants } = m.terms;
  const attrs = Object.entries(item.requiredAttributes)
    .map(([k, v]) => `${k} ${v}`)
    .join(", ");
  const merchants = allowedMerchants.length > 0 ? allowedMerchants.join(", ") : "any merchant";
  return [
    "You are a shopping agent buying on behalf of a user, under a mandate they approved.",
    `Buy: ${item.query}${attrs ? ` (required: ${attrs})` : ""}.`,
    `Maximum price per item: $${formatUsd(maxUnitPrice)}. Total budget: $${formatUsd(budget)}. Merchants: ${merchants}.`,
    'Find a matching product with search_products, then call propose_order with the exact product_id, merchant and options (for example {"Size":"10"}).',
    "The tool result tells you whether the purchase was allowed or blocked. If blocked, try another product.",
    "Call finish after one successful purchase.",
  ].join("\n");
};

const proposeTool = async (
  deps: ShoppingAgentDeps,
  mandateId: string,
  a: Record<string, unknown>,
): Promise<string> => {
  const { product_id, merchant, options } = a;
  const opts =
    typeof options === "object" && options !== null && !Array.isArray(options)
      ? Object.entries(options)
      : null;
  if (!isString(product_id) || !isString(merchant) || !opts?.every(([, v]) => isString(v)))
    return INVALID;
  const { verdict, captureId } = await proposeOrder(deps, {
    mandateId,
    productId: product_id,
    merchant,
    options: Object.fromEntries(opts) as Record<string, string>,
    source: "agent",
  });
  return JSON.stringify(
    verdict.kind === "allow"
      ? { verdict: "allowed", captureId }
      : { verdict: "blocked", reasons: verdict.reasons, details: verdict.details },
  );
};

export const runShoppingAgent = async (
  deps: ShoppingAgentDeps,
  i: { mandateId: string; maxSteps?: number },
): Promise<AgentRunResult> => {
  const mandate = await deps.repo.get(i.mandateId);
  if (!mandate) throw new Error(`Unknown mandate ${i.mandateId}`);
  const maxSteps = i.maxSteps ?? 6;
  const messages: AgentMessage[] = [
    { role: "system", content: systemPrompt(mandate) },
    { role: "user", content: "Please make the purchase." },
  ];
  let steps = 0;
  try {
    while (steps < maxSteps) {
      const turn = await deps.model.next([...messages], AGENT_TOOLS);
      steps++;
      if (turn.kind === "final") return { steps, outcome: "finished", summary: turn.text };
      messages.push({ role: "assistant", content: "", toolCalls: turn.calls });
      for (const call of turn.calls) {
        await deps.repo.appendAudit(mandate.id, {
          at: deps.clock.now(),
          kind: "agent_step",
          message: `Agent called ${call.name}`,
          data: { tool: call.name, args: call.argsJson.slice(0, 200) },
        });
        const args = parseArgs(call.argsJson);
        if (call.name === "finish") {
          const summary = args && isString(args.summary) ? args.summary : "";
          return { steps, outcome: "finished", summary };
        }
        messages.push({
          role: "tool",
          toolCallId: call.id,
          content: await runTool(deps, mandate.id, call, args),
        });
      }
    }
    return {
      steps,
      outcome: "step_limit",
      summary: "Step limit reached before the agent finished",
    };
  } catch (err) {
    console.error(err); // server-side only
    const summary = (err instanceof Error ? err.message : "unknown error").slice(0, 200);
    await deps.repo
      .appendAudit(mandate.id, {
        at: deps.clock.now(),
        kind: "agent_step",
        message: `Agent stopped with an error: ${summary}`,
      })
      .catch((auditErr: unknown) => console.error(auditErr));
    return { steps, outcome: "error", summary };
  }
};

const runTool = (
  deps: ShoppingAgentDeps,
  mandateId: string,
  call: AgentToolCall,
  args: Record<string, unknown> | null,
): Promise<string> | string => {
  if (call.name !== "search_products" && call.name !== "propose_order")
    return JSON.stringify({ error: `unknown tool ${call.name.slice(0, 100)}` });
  if (!args) return INVALID;
  return call.name === "search_products"
    ? searchTool(deps, args)
    : proposeTool(deps, mandateId, args);
};
