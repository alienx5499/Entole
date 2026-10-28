import { expect, test } from "bun:test";
import { createFunded, harness, login, NOW } from "./harness.ts";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
type View = { audit: { kind: string; message: string; data?: Record<string, string> }[] };

const post = (h: ReturnType<typeof harness>, path: string, payload: unknown, init = {}) =>
  h.call(path, { method: "POST", body: JSON.stringify(payload), ...init });

const setup = async () => {
  const h = harness();
  const cookie = await login(h);
  const id = await createFunded(h, cookie); // validDays 3: the window ends at NOW + 3 days
  const url = (step: string) => `/api/mandates/${id}/schedule/${step}`;
  return { h, cookie, id, url };
};

const last = async (res: Response) => ((await res.json()) as View).audit.at(-1);

test("schedule routes need a session", async () => {
  const { h, url } = await setup();
  expect((await post(h, url("propose"), {})).status).toBe(401);
  expect((await post(h, url("decide"), { accept: true })).status).toBe(401);
});

test("the watcher proposes a sooner check from the price gap; nothing is armed yet", async () => {
  const { h, cookie, id, url } = await setup();
  // The only known price is the $180 baseline against a $170 limit: 5.9% above, so 15 minutes.
  const res = await post(h, url("propose"), {}, { cookie });
  expect(res.status).toBe(200);
  expect(await last(res)).toMatchObject({
    kind: "agent_step",
    data: {
      schedule: "proposed",
      at: new Date(NOW.getTime() + 15 * MIN).toISOString(),
      by: "watcher",
    },
  });
  expect(h.watch.scheduledCheckAt(id)).toBeNull();
});

test("a proposal outside the signed window is refused", async () => {
  const { h, cookie, url } = await setup();
  const at = (ms: number) => ({ at: new Date(NOW.getTime() + ms).toISOString() });
  const late = await post(h, url("propose"), at(3 * DAY + MIN), { cookie });
  expect(late.status).toBe(422);
  expect(await late.json()).toEqual({ error: "past_valid_until" });
  expect((await post(h, url("propose"), at(-MIN), { cookie })).status).toBe(422);
  expect((await post(h, url("propose"), { at: "soon" }, { cookie })).status).toBe(400);
  // Right on the window's end is still inside it.
  expect((await post(h, url("propose"), at(3 * DAY), { cookie })).status).toBe(200);
});

test("the buyer drags the proposal and accepts; the server re-checks the dragged time", async () => {
  const { h, cookie, id, url } = await setup();
  await post(
    h,
    url("propose"),
    { at: new Date(NOW.getTime() + 30 * MIN).toISOString() },
    { cookie },
  );

  const tooLate = new Date(NOW.getTime() + 4 * DAY).toISOString();
  const refused = await post(h, url("decide"), { accept: true, at: tooLate }, { cookie });
  expect(refused.status).toBe(422);
  expect(h.watch.scheduledCheckAt(id)).toBeNull();

  const dragged = new Date(NOW.getTime() + 2 * 60 * MIN);
  const res = await post(h, url("decide"), { accept: true, at: dragged.toISOString() }, { cookie });
  expect(res.status).toBe(200);
  expect(await last(res)).toMatchObject({
    data: { schedule: "accepted", at: dragged.toISOString() },
  });
  expect(h.watch.scheduledCheckAt(id)).toEqual(dragged);
  // Answered: a second decision has nothing to act on.
  expect((await post(h, url("decide"), { accept: true }, { cookie })).status).toBe(409);
  // Closing the order disarms the extra check.
  await h.call(`/api/mandates/${id}/close`, { method: "POST", cookie });
  expect(h.watch.scheduledCheckAt(id)).toBeNull();
  expect((await post(h, url("propose"), {}, { cookie })).status).toBe(409);
});

test("rejecting arms nothing", async () => {
  const { h, cookie, id, url } = await setup();
  await post(h, url("propose"), {}, { cookie });
  const res = await post(h, url("decide"), { accept: false }, { cookie });
  expect((await last(res))?.data).toEqual({ schedule: "rejected" });
  expect(h.watch.scheduledCheckAt(id)).toBeNull();
});

test("an AI client may propose but only the buyer's session may decide", async () => {
  const { h, cookie, url } = await setup();
  const minted = await post(h, "/api/tokens", { name: "Desktop agent" }, { cookie });
  const { token } = (await minted.json()) as { token: string };
  const bearer = { headers: { authorization: `Bearer ${token}` } };
  const at = new Date(NOW.getTime() + 20 * MIN).toISOString();
  const res = await post(h, url("propose"), { at, reason: "Sale starts soon" }, bearer);
  expect(await last(res)).toMatchObject({
    data: { schedule: "proposed", by: "ai_client", reason: "Sale starts soon" },
  });
  expect((await post(h, url("decide"), { accept: true }, bearer)).status).toBe(401);
});

test("another buyer cannot touch the schedule", async () => {
  const { h, url } = await setup();
  const other = await login(h, "someone-else");
  expect((await post(h, url("propose"), {}, { cookie: other })).status).toBe(403);
});
