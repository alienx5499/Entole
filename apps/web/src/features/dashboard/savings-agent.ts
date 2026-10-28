// The dashboard's AI panel: a custom Savings explainer up front, with AG Studio's five built-in
// agents behind it. All six run Studio's own loop in the browser against `studioLlm`. The explainer
// answers money questions from its `savings_breakdown` tool and hands anything about changing the
// dashboard, or querying it in ways its tool cannot, to the built-in lead or data agent.

import type { AgAiHarnessSetup } from "ag-studio";
import { createAiHarness, directLlmRunner } from "ag-studio";
import { explainSavings, kpis, type OrderRow } from "./dashboard-data";
import { studioLlm } from "./studio-llm";

const AGENT_ID = "savings-explainer";
const TOOL = "savings_breakdown";
// A long order history is cut to the newest rows; the data agent can query the rest.
const MAX_ROWS = 50;

const INSTRUCTIONS = `You are the Savings explainer on an Entole dashboard. Entole holds money on PayPal up to a limit the shopper signs, and its agent buys only at or under that limit. Money is USD.

Answer the shopper's actual question in two to five plain sentences.
- Call ${TOOL} before giving any number, and use only the numbers it returns. Never estimate.
- Savings is the gap between the item's usual price and what was paid. A released order bought nothing and cost nothing. "Held now" is money still reserved for orders being watched.
- If the question needs a breakdown the tool does not give (by date, by price point, a chart), delegate it to the data agent.
- If the shopper asks to add, move, filter or change widgets, delegate it to the lead agent and then tell them what changed.
- Once you know what the conversation is about, give it a short name with rename_thread.`;

export function savingsAgent(rows: OrderRow[]): AgAiHarnessSetup {
  return ({ api }) => {
    const breakdown = api.defineAiTool({
      name: TOOL,
      description:
        "Totals for the shopper's limit orders (held now, spent, saved, bought, released) and one line per order with its shop, outcome, limit, paid and saved amounts.",
      params: (s) => s.object({}),
      execute: (_args, ctx) =>
        ctx.success(explainSavings(rows), {
          totals: kpis(rows),
          orders: rows.slice(0, MAX_ROWS).map((r) => ({
            order: r.order,
            shop: r.shop,
            product: r.product,
            outcome: r.outcome,
            limit: r.limit,
            paid: r.paid,
            saved: r.saved,
            heldNow: r.heldNow,
            createdAt: r.createdAt,
          })),
        }),
    });

    return createAiHarness(api, ({ builtIn, tools }) => ({
      agents: [
        directLlmRunner({
          id: AGENT_ID,
          name: "Savings explainer",
          description: "Explains what your limit orders saved, spent and still hold.",
          instructions: () => INSTRUCTIONS,
          tools: () => [breakdown, tools.delegateTo(["lead", "data"]), tools.renameThread()],
          maxTurns: 8,
          adapter: studioLlm,
        }),
        ...Object.values(builtIn).map((agent) => directLlmRunner({ ...agent, adapter: studioLlm })),
      ],
      primary: AGENT_ID,
      promptStarters: [
        { label: "Explain my savings", prompt: "How much have my limit orders saved me?" },
        { label: "What is on hold?", prompt: "How much money is still on hold, and for what?" },
        {
          label: "Chart savings by shop",
          prompt: "Add a chart of how much I saved at each shop.",
        },
      ],
    }));
  };
}
