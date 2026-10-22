import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import fixtures from "../public/demo-media/manifest.json" with { type: "json" };
import {
  evaluateVerification,
  requirePermission,
  assertLocation,
  simulateGate,
} from "../lib/seamless/core.mjs";
import { withDeadline } from "../lib/seamless/adapters.mjs";
import { createSeamlessService } from "../lib/seamless/service.mjs";
const location = { station: "CGK", loungeId: "lounge-1" };
for (const fixture of fixtures)
  test(`decision: ${fixture.id}`, async () => {
    const result = await evaluateVerification({
      mode: "DEMO",
      fixture,
      location,
    });
    assert.equal(result.decision, fixture.expectedDecision);
    assert.equal(result.reason, fixture.expectedReason);
    const gate = simulateGate({
      eligible: result.decision === "ELIGIBLE",
      behavior: "confirmed",
      deviceId: "DEMO-1",
      loungeId: location.loungeId,
    });
    assert.equal(gate.commandIssued, result.decision === "ELIGIBLE");
    assert.equal(gate.physicalOpenConfirmed, false);
  });
test("LIVE stays unavailable even if a valid demo scenario is supplied", async () => {
  const r = await evaluateVerification({
    mode: "LIVE",
    fixture: fixtures[0],
    location,
  });
  assert.equal(r.reason, "LIVE_NOT_CONFIGURED");
  assert.equal(r.decision, "NOT_ELIGIBLE");
});
test("malformed identity and entitlement responses fail closed", async () => {
  for (const response of [
    null,
    {},
    { available: true, captured: true, matched: true },
    {
      available: true,
      captured: true,
      matched: true,
      category: "Passenger",
      referenceId: "wrong",
    },
  ]) {
    assert.equal(
      (
        await evaluateVerification({
          mode: "DEMO",
          fixture: fixtures[0],
          location,
          identityAdapter: async () => response,
        })
      ).decision,
      "NOT_ELIGIBLE",
    );
  }
  for (const response of [
    null,
    {},
    { available: true, record: {} },
    {
      available: true,
      record: { referenceId: fixtures[0].id },
      entitlement: { decision: "ELIGIBLE", validUntil: "never" },
    },
  ]) {
    assert.equal(
      (
        await evaluateVerification({
          mode: "DEMO",
          fixture: fixtures[0],
          location,
          passengerAdapter: async () => response,
        })
      ).decision,
      "NOT_ELIGIBLE",
    );
  }
});
test("provider exception cannot approve and deadline cancels work", async () => {
  let aborted = false;
  await assert.rejects(
    withDeadline(
      (signal) =>
        new Promise(() =>
          signal.addEventListener("abort", () => {
            aborted = true;
          }),
        ),
      5,
    ),
    /SERVICE_TIMEOUT/,
  );
  assert.equal(aborted, true);
  const r = await evaluateVerification({
    mode: "DEMO",
    fixture: fixtures[0],
    location,
    passengerAdapter: async () => {
      throw new Error("secret-provider-detail");
    },
  });
  assert.equal(r.reason, "PASSENGER_SERVICE_UNAVAILABLE");
  assert.doesNotMatch(JSON.stringify(r), /secret-provider-detail/);
});
for (const [behavior, state, command] of [
  ["offline", "DEVICE_UNAVAILABLE", false],
  ["accepted", "COMMAND_ACCEPTED", true],
  ["timeout", "COMMAND_TIMEOUT", true],
  ["wrong-device", "ACK_REJECTED", true],
  ["fault", "GATE_FAULT", true],
  ["confirmed", "SIMULATED_OPEN_CONFIRMED", true],
])
  test(`gate: ${behavior}`, () => {
    const r = simulateGate({
      eligible: true,
      behavior,
      deviceId: "D1",
      loungeId: "L1",
    });
    assert.equal(r.state, state);
    assert.equal(r.commandIssued, command);
    assert.equal(r.physicalOpenConfirmed, false);
    assert.equal(
      simulateGate({ eligible: false, behavior }).commandIssued,
      false,
    );
  });
const admin = {
  decoded: { uid: "admin-1" },
  profile: { active: true, role: "Admin", station: "ALL" },
};
const officer = {
  decoded: { uid: "officer-1" },
  profile: {
    active: true,
    role: "Lounge Officer",
    station: "CGK",
    loungeId: "lounge-1",
  },
};
const lounge = {
  id: "lounge-1",
  airport: "CGK",
  name: "Lounge test",
  status: "Aktif",
};
test("permissions reject unauthenticated, inactive, password-change and unauthorized roles", () => {
  for (const actor of [
    null,
    { ...admin, profile: { ...admin.profile, active: false } },
    { ...admin, profile: { ...admin.profile, role: "Report Viewer" } },
    { ...admin, profile: { ...admin.profile, mustChangePassword: true } },
  ])
    assert.throws(() => requirePermission(actor), { status: 403 });
  assert.throws(() => requirePermission(officer, true), { status: 403 });
  assert.throws(() => assertLocation(officer, { ...lounge, id: "other" }), {
    status: 403,
  });
  assert.throws(() => assertLocation(officer, { ...lounge, airport: "DPS" }), {
    status: 403,
  });
  assert.throws(
    () => assertLocation(admin, { ...lounge, status: "Nonaktif" }),
    { status: 409 },
  );
});
// Firestore behavior double. Transaction writes commit only on success and are
// serialized, modelling request replay races without claiming emulator coverage.
class MemoryDB {
  rows = new Map();
  queue = Promise.resolve();
  constructor() {
    this.rows.set("users/admin-1", structuredClone(admin.profile));
    this.rows.set("users/officer-1", structuredClone(officer.profile));
    this.rows.set("lounges/lounge-1", lounge);
  }
  collection(path) {
    return this.query(path);
  }
  query(path, filters = [], order = "", after = null, max = Infinity) {
    return {
      doc: (key = crypto.randomUUID()) => ({
        path: `${path}/${key}`,
        id: key,
        get: async () => this.snap(`${path}/${key}`),
        collection: (name) => this.query(`${path}/${key}/${name}`),
      }),
      where: (key, _, value) =>
        this.query(path, [...filters, [key, value]], order, after, max),
      orderBy: (key) => this.query(path, filters, key, after, max),
      startAfter: (value) => this.query(path, filters, order, value, max),
      limit: (n) => this.query(path, filters, order, after, n),
      get: async () => {
        let docs = [...this.rows.keys()]
          .filter(
            (k) =>
              k.startsWith(`${path}/`) &&
              k.slice(path.length + 1).split("/").length === 1,
          )
          .map((k) => this.snap(k))
          .filter((s) => filters.every(([k, v]) => s.data()[k] === v));
        docs.sort((a, b) =>
          order === "createdAt"
            ? String(b.data().createdAt).localeCompare(
                String(a.data().createdAt),
              ) || b.id.localeCompare(a.id)
            : a.id.localeCompare(b.id),
        );
        if (after) {
          const key = typeof after === "string" ? after : after.id;
          docs = docs.slice(docs.findIndex((d) => d.id === key) + 1);
        }
        return { docs: docs.slice(0, max) };
      },
    };
  }
  snap(path) {
    return {
      id: path.split("/").at(-1),
      exists: this.rows.has(path),
      data: () => structuredClone(this.rows.get(path)),
    };
  }
  runTransaction(fn) {
    const task = this.queue.then(async () => {
      const staged = [];
      const tx = {
        get: async (ref) => this.snap(ref.path),
        create: (ref, data) => {
          assert.equal(this.rows.has(ref.path), false);
          staged.push([ref.path, data]);
        },
        set: (ref, data) => staged.push([ref.path, data]),
        update: (ref, data) =>
          staged.push([ref.path, { ...this.rows.get(ref.path), ...data }]),
      };
      const r = await fn(tx);
      for (const [path, data] of staged)
        this.rows.set(path, structuredClone(data));
      return r;
    });
    this.queue = task.catch(() => {});
    return task;
  }
}
function setup(actor = admin) {
  const db = new MemoryDB();
  const handle = createSeamlessService({
    authenticate: async () => actor,
    database: () => db,
    audit: (tx, d, _, record) =>
      tx.set(d.collection("auditLogs").doc(), record),
  });
  const call = (input) =>
    handle(
      new Request("http://localhost/.netlify/functions/seamless-access", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    );
  return { db, call };
}
const payload = {
  action: "verify",
  mode: "DEMO",
  scenarioId: "passenger-valid",
  loungeId: "lounge-1",
  requestId: "request-0001",
};
test("persists decision, simulated acknowledgements and audit; refresh retrieves saved result", async () => {
  const { db, call } = setup();
  const r = await call(payload);
  assert.equal(r.decision, "ELIGIBLE");
  const logs = await call({ action: "activity", loungeId: "lounge-1" });
  assert.equal(logs.activity[0].id, r.id);
  assert.ok([...db.rows.keys()].some((k) => k.startsWith("auditLogs/")));
  assert.equal(logs.activity[0].gate.physicalOpenConfirmed, false);
});
test("parallel clicks/network retry/reload return one persisted command sequence", async () => {
  const { db, call } = setup();
  const rows = await Promise.all([call(payload), call(payload), call(payload)]);
  assert.equal(rows.filter((r) => !r.replayed).length, 1);
  assert.equal(
    [...db.rows.keys()].filter((k) => k.includes("/attempts/")).length,
    1,
  );
  const before = db.rows.size;
  const replay = await call(payload);
  assert.equal(replay.replayed, true);
  assert.equal(db.rows.size, before);
  await assert.rejects(call({ ...payload, gateBehavior: "offline" }), {
    status: 409,
  });
});
test("denied attempts persist without any opening command", async () => {
  const { call } = setup();
  const r = await call({ ...payload, scenarioId: "passenger-invalid" });
  assert.equal(r.decision, "NOT_ELIGIBLE");
  assert.equal(r.gate.commandIssued, false);
  assert.equal(
    (await call({ action: "activity", loungeId: "lounge-1" })).activity.length,
    1,
  );
});
test("staff enrollment, scope update and deactivation survive a fresh service instance", async () => {
  const { db, call } = setup();
  const save = {
    action: "staff-save",
    uid: "officer-1",
    operation: "enroll",
    loungeIds: ["lounge-1"],
    privacyConfirmed: true,
    identityConfirmed: true,
  };
  await call(save);
  assert.equal(
    db.rows.get("users/officer-1").seamlessDemo.enrollmentStatus,
    "Enrolled",
  );
  assert.equal(db.rows.get("users/officer-1").role, "Lounge Officer");
  const second = createSeamlessService({
    authenticate: async () => admin,
    database: () => db,
    audit: () => {},
  });
  const listing = await second(
    new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ action: "staff-list" }),
    }),
  );
  assert.equal(
    listing.staff.find((s) => s.uid === "officer-1").enrollment
      .enrollmentStatus,
    "Enrolled",
  );
  assert.doesNotMatch(JSON.stringify(listing), /DEMO:officer/);
  assert.equal(
    (await call({ ...payload, subjectUid: "officer-1" })).decision,
    "ELIGIBLE",
  );
  await call({ ...save, operation: "update" });
  await call({ ...save, operation: "deactivate" });
  assert.equal(
    (
      await call({
        ...payload,
        requestId: "request-0002",
        subjectUid: "officer-1",
      })
    ).reason,
    "STAFF_INACTIVE",
  );
});
test("backend blocks unauthorized staff list, enroll, update, logs and managed identity lookup", async () => {
  const { call } = setup(officer);
  for (const input of [
    { action: "staff-list" },
    { action: "staff-save", uid: "officer-1", operation: "enroll" },
    { ...payload, subjectUid: "officer-1" },
    { action: "activity", loungeId: "other" },
  ])
    await assert.rejects(call(input), (e) => [403, 409].includes(e.status));
  const unauth = setup(null);
  await assert.rejects(unauth.call({ action: "staff-list" }), { status: 403 });
});
test("staff enrollment requires identity confirmation, notice, existing profile and valid location", async () => {
  const { call } = setup();
  const p = {
    action: "staff-save",
    uid: "officer-1",
    operation: "enroll",
    loungeIds: ["lounge-1"],
    privacyConfirmed: true,
    identityConfirmed: true,
  };
  for (const change of [
    { privacyConfirmed: false },
    { identityConfirmed: false },
    { loungeIds: ["other"] },
    { uid: "missing" },
    { operation: "upload-photo" },
    { loungeIds: [] },
  ])
    await assert.rejects(call({ ...p, ...change }));
});
test("invalid request, unsafe identifiers and live fallback reject safely", async () => {
  const { call } = setup();
  await assert.rejects(call({ ...payload, loungeId: "../../users" }), {
    status: 400,
  });
  await assert.rejects(call({ ...payload, scenarioId: "unknown" }), {
    status: 400,
  });
  await assert.rejects(call({ ...payload, mode: "AUTO" }), { status: 400 });
  const r = await call({ ...payload, mode: "LIVE" });
  assert.equal(r.reason, "LIVE_NOT_CONFIGURED");
  assert.equal(r.gate.commandIssued, false);
});
test("new public assets are synthetic and contain no credential or biometric fields", async () => {
  assert.ok(
    fixtures.every(
      (f) => f.mode === "DEMO" && f.displayName.startsWith("DEMO "),
    ),
  );
  const raw = JSON.stringify(fixtures);
  assert.doesNotMatch(
    raw,
    /private_key|embedding|template|email|passport|ticketNumber/i,
  );
  const page = await readFile(
    new URL("../app/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(page, /href="\/\?view=seamless"/);
  assert.match(page, /Gunakan Input Manual/);
  assert.match(page, /scanBarcodeImage/);
  assert.match(page, /createVisitor\(firebaseUser, visitor\)/);
});
test("deactivation remains available after a lounge or staff role becomes inactive", async () => {
  const { call, db } = setup();
  const p = {
    action: "staff-save",
    uid: "officer-1",
    operation: "enroll",
    loungeIds: ["lounge-1"],
    privacyConfirmed: true,
    identityConfirmed: true,
  };
  await call(p);
  db.rows.set("lounges/lounge-1", { ...lounge, status: "Nonaktif" });
  db.rows.set("users/officer-1", {
    ...db.rows.get("users/officer-1"),
    role: "Report Viewer",
  });
  await call({ ...p, operation: "deactivate", loungeIds: [] });
  assert.equal(db.rows.get("users/officer-1").seamlessDemo.active, false);
});
test("pending reservation replay never creates a new command", async () => {
  const { call, db } = setup();
  await call(payload);
  const path = [...db.rows.keys()].find((k) =>
    k.startsWith("seamlessDemoRequests/"),
  );
  const r = db.rows.get(path);
  delete r.result;
  r.status = "PENDING";
  db.rows.set(path, r);
  const count = db.rows.size;
  const replay = await call(payload);
  assert.equal(replay.status, "PENDING");
  assert.equal(db.rows.size, count);
});
test("real function entry rejects unauthenticated requests before accessing Firebase", async () => {
  const { default: handler } =
    await import("../netlify/functions/seamless-access.mjs");
  const response = await handler(
    new Request("http://localhost/.netlify/functions/seamless-access", {
      method: "POST",
      body: "{}",
    }),
  );
  assert.equal(response.status, 401);
  assert.doesNotMatch(
    await response.text(),
    /PRIVATE_KEY|clientEmail|providerReference/,
  );
});
test("entitlement scoped to another lounge or station cannot grant access", async () => {
  for (const e of [
    { station: "DPS", loungeId: location.loungeId },
    { station: location.station, loungeId: "other" },
  ]) {
    const r = await evaluateVerification({
      mode: "DEMO",
      fixture: fixtures[0],
      location,
      passengerAdapter: async () => ({
        available: true,
        record: { referenceId: fixtures[0].id },
        entitlement: {
          decision: "ELIGIBLE",
          validUntil: Date.now() + 60000,
          policy: "DEMO_ONLY",
          ...e,
        },
      }),
    });
    assert.equal(r.decision, "NOT_ELIGIBLE");
  }
});
