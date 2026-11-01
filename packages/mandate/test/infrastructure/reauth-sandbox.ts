// Manual sandbox check of hold renewal. PayPal refuses a reauthorize inside the 3-day honor period
// and sandbox time cannot be moved, so the hold has to age for real:
//   day 0: bun packages/mandate/test/infrastructure/reauth-sandbox.ts hold
//          approve the printed URL as the sandbox buyer, then
//          bun packages/mandate/test/infrastructure/reauth-sandbox.ts authorize <orderId>
//   day 4: bun packages/mandate/test/infrastructure/reauth-sandbox.ts renew <authorizationId>
//          then once more on the new id, to see whether a renewed hold can be renewed again.
// Reads PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET and PAYPAL_API_BASE (sandbox only).
import { usd } from "@entole/shared-kernel";
import { readEnv } from "@entole/testing";
import { PayPalGateway } from "../../src/index.ts";

const AMOUNT = usd(1000);
const baseUrl = readEnv("PAYPAL_API_BASE");
if (!baseUrl.includes("sandbox")) throw new Error("Sandbox only");
const gateway = new PayPalGateway({
  clientId: readEnv("PAYPAL_CLIENT_ID"),
  clientSecret: readEnv("PAYPAL_CLIENT_SECRET"),
  baseUrl,
});

const [command, id] = process.argv.slice(2);
if (command === "hold") {
  const r = await gateway.createAuthorizationOrder({
    mandateId: `reauth-${Date.now()}`,
    amount: AMOUNT,
    customId: "reauth-sandbox-check",
    description: "Entole hold renewal check",
    returnUrl: "https://example.com/return",
    cancelUrl: "https://example.com/cancel",
  });
  console.log(r);
} else if (command === "authorize" && id) {
  const r = await gateway.authorizeOrder(id);
  console.log({ ...r, authorizedAt: new Date().toISOString() });
} else if (command === "renew" && id) {
  // A fresh request id per run, so a second try is a real second call and not a replay.
  console.log(
    await gateway.reauthorize({
      authorizationId: id,
      amount: AMOUNT,
      idempotencyKey: `reauth-sandbox-${Date.now()}`,
    }),
  );
} else {
  console.log("usage: reauth-sandbox.ts hold | authorize <orderId> | renew <authorizationId>");
}
