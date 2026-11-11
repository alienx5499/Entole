// Recomputes a mandate's SHA-256 digest from its signed terms and compares it with the stored
// digest and, when a PayPal order id is given, with that order's custom_id.
//   bun run verify:order <mandate.json> [paypalOrderId]
// The JSON is a mandate as stored (the `data` column of the mandates table). The order lookup reads
// PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET and PAYPAL_API_BASE (sandbox only).
import { mandateDigest, mandateFromJson, PayPalGateway } from "@entole/mandate";

const SANDBOX_API = "https://api-m.sandbox.paypal.com";

const readEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env ${name}`);
  return value;
};

const paypalCustomId = async (orderId: string): Promise<string> => {
  const baseUrl = readEnv("PAYPAL_API_BASE").replace(/\/+$/, "");
  if (baseUrl !== SANDBOX_API) throw new Error(`PAYPAL_API_BASE must be ${SANDBOX_API}`);
  const gateway = new PayPalGateway({
    clientId: readEnv("PAYPAL_CLIENT_ID"),
    clientSecret: readEnv("PAYPAL_CLIENT_SECRET"),
    baseUrl,
  });
  return (await gateway.getOrder(orderId)).customId;
};

const [file, orderId] = process.argv.slice(2);
if (!file) {
  console.error("Usage: bun run verify:order <mandate.json> [paypalOrderId]");
  process.exit(2);
}

const mandate = mandateFromJson(await Bun.file(file).json());
const recomputed = mandateDigest(mandate.id, mandate.terms, mandate.replay);
const checks: [string, string][] = [["stored digest", mandate.digest]];
if (orderId) checks.push([`PayPal order ${orderId} custom_id`, await paypalCustomId(orderId)]);

console.log(`mandate     ${mandate.id}`);
console.log(`recomputed  ${recomputed}`);
let ok = true;
for (const [label, value] of checks) {
  const same = value === recomputed;
  ok &&= same;
  console.log(`${same ? "match   " : "MISMATCH"}  ${label}: ${value}`);
}
console.log(ok ? "OK: the signed terms produce this digest." : "FAIL: the terms were changed.");
process.exit(ok ? 0 : 1);
