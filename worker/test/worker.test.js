import { SELF, env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const headers = { "content-type": "application/json", "x-app-pin": "123456" };

describe("Escape Call API", () => {
  it("serves the mobile UI with every source and allowed delay", async () => {
    const response = await SELF.fetch("https://example.com/");
    const html = await response.text();
    expect(response.status).toBe(200);
    for (const text of ["SECOM監視センター", "ALSOK監視センター", "にしけい監視センター", "[1,3,5,10,30,60]"]) {
      expect(html).toContain(text);
    }
  });

  it("rejects a missing or incorrect PIN", async () => {
    const init = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source: "secom", minutes: 1 }) };
    expect((await SELF.fetch("https://example.com/api/schedule", init)).status).toBe(401);
    init.headers["x-app-pin"] = "000000";
    expect((await SELF.fetch("https://example.com/api/schedule", init)).status).toBe(401);
  });

  it("validates source and delay", async () => {
    for (const body of [{ source: "unknown", minutes: 1 }, { source: "secom", minutes: 2 }]) {
      const response = await SELF.fetch("https://example.com/api/schedule", { method: "POST", headers, body: JSON.stringify(body) });
      expect(response.status).toBe(400);
    }
  });

  it("schedules, reports, and cancels an alarm", async () => {
    const before = Date.now();
    const scheduled = await SELF.fetch("https://example.com/api/schedule", {
      method: "POST", headers, body: JSON.stringify({ source: "alsok", minutes: 3 })
    });
    expect(scheduled.status).toBe(201);
    const job = await scheduled.json();
    expect(job.runAt).toBeGreaterThanOrEqual(before + 180000);

    const status = await (await SELF.fetch(`https://example.com/api/status/${job.id}`, { headers })).json();
    expect(status).toMatchObject({ source: "alsok", cancelled: false, runAt: job.runAt });

    const stub = env.CALL_JOBS.get(env.CALL_JOBS.idFromString(job.id));
    await runInDurableObject(stub, async (_instance, state) => {
      expect(await state.storage.getAlarm()).toBe(job.runAt);
    });

    expect((await SELF.fetch(`https://example.com/api/cancel/${job.id}`, { method: "POST", headers })).status).toBe(200);
    const cancelled = await (await SELF.fetch(`https://example.com/api/status/${job.id}`, { headers })).json();
    expect(cancelled.cancelled).toBe(true);
    await runInDurableObject(stub, async (_instance, state) => {
      expect(await state.storage.getAlarm()).toBeNull();
    });
  });
});
