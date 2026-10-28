import { expect, test } from "bun:test";
import { createFunded, harness, login } from "./harness.ts";

test("AP2 export is owner-only and downloads the open mandates with PayPal ids", async () => {
  const h = harness();
  const cookie = await login(h);
  const id = await createFunded(h, cookie);

  expect((await h.call(`/api/mandates/${id}/ap2`)).status).toBe(401);
  const stranger = await login(h, "someone-else");
  expect((await h.call(`/api/mandates/${id}/ap2`, { cookie: stranger })).status).toBe(403);
  expect((await h.call("/api/mandates/nope/ap2", { cookie })).status).toBe(404);

  const res = await h.call(`/api/mandates/${id}/ap2`, { cookie });
  expect(res.status).toBe(200);
  expect(res.headers.get("content-disposition")).toBe(
    `attachment; filename="entole-${id}-ap2.json"`,
  );
  const out = (await res.json()) as {
    version: string;
    entole: { digest: string; paypal: { orderId: string | null; authorizationId: string | null } };
    openCheckoutMandate: { vct: string };
    checkoutMandate: unknown;
  };
  expect(out.version).toBe("0.2");
  expect(out.entole.digest).toMatch(/^[0-9a-f]{64}$/);
  expect(out.entole.paypal.orderId).not.toBeNull();
  expect(out.entole.paypal.authorizationId).not.toBeNull();
  expect(out.openCheckoutMandate.vct).toBe("mandate.checkout.open.1");
  expect(out.checkoutMandate).toBeNull();
});
