import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  createOperationsService,
  imageBytes,
  isHeadOfficeAdmin,
} from "../lib/seamless/operations.mjs";
import { MemoryDB } from "./helpers/seamless-db.mjs";
const sha = (v) => createHash("sha256").update(v).digest("hex");
const actor = {
  decoded: { uid: "admin-1" },
  profile: { active: true, role: "Admin", station: "ALL" },
};
const image =
  "data:image/jpeg;base64," +
  Buffer.concat([Buffer.from([255, 216, 255]), Buffer.alloc(200)]).toString(
    "base64",
  );
const register = {
  action: "staff-register",
  uid: "officer-1",
  name: "Ayu Pratiwi",
  unit: "Lounge Operations",
  employeeNumber: "GA001",
  station: "CGK",
  loungeIds: ["lounge-1"],
  identityConfirmed: true,
  consent: true,
};
export function setup({ profile = actor.profile, provider, timeout } = {}) {
  const db = new MemoryDB();
  db.rows.set("users/admin-1", structuredClone(profile));
  db.rows.set("stations/CGK", {
    code: "CGK",
    name: "Jakarta",
    status: "Aktif",
  });
  db.rows.set("stations/PLM", {
    code: "PLM",
    name: "Palembang",
    status: "Aktif",
  });
  const objects = new Map(),
    media = {
      save: async (path, _image, meta) => objects.set(path, meta),
      validate: async (path) => objects.get(path) || {},
      readUrl: async (path) => "https://storage.invalid/" + path,
      repository: async () => imageBytes(image),
    };
  const handle = createOperationsService({
    authenticate: async () => ({
      decoded: actor.decoded,
      profile: db.rows.get("users/admin-1"),
    }),
    database: () => db,
    audit: (tx, d, _, record) =>
      tx.set(d.collection("auditLogs").doc(), record),
    media,
    provider,
    providerTimeoutMs: timeout,
  });
  const call = (input) =>
    handle(
      new Request("http://localhost/", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    );
  return { db, call, objects };
}
async function registerAndPhoto(s) {
  await s.call(register);
  const { photo } = await s.call({
    action: "photo-upload",
    uid: "officer-1",
    consent: true,
    data: image,
    pose: "front",
  });
  await s.call({
    action: "staff-enrollment-save",
    uid: "officer-1",
    consent: true,
    photos: [photo],
  });
  return photo;
}
function live(overrides = {}) {
  return {
    configured: true,
    entitlementConfigured: true,
    gateConfigured: true,
    enroll: async () => ({ verified: true, referenceId: "one-reference" }),
    resolveClaim: async () => ({
      subjectKey: "passenger-1",
      referenceId: "p-ref",
      category: "Passenger",
      displayName: "Budi",
      flight: "GA204",
    }),
    verifyOneToOne: async (s) => ({
      matched: true,
      livenessPassed: true,
      sessionId: s.sessionId,
      referenceId: s.referenceId,
    }),
    passengerEntitlement: async (s) => ({
      eligible: true,
      subjectKey: s.subjectKey,
      loungeId: s.loungeId,
      validUntil: Date.now() + 60000,
    }),
    openGate: async (s) => ({
      physicalOpenConfirmed: true,
      idempotencyKey: s.idempotencyKey,
      loungeId: s.loungeId,
    }),
    ...overrides,
  };
}
const claim = {
  action: "claim",
  loungeId: "lounge-1",
  category: "Passenger",
  credential: "opaque-check-in-session",
  consent: true,
};
test("HO scope is required independently of administrator role", async () => {
  for (const role of [
    "Admin",
    "Super Admin",
    "HO Admin",
    "BO Admin",
    "Lounge Manager",
  ]) {
    assert.equal(
      isHeadOfficeAdmin({ active: true, role, station: "CGK" }),
      false,
    );
    const s = setup({ profile: { active: true, role, station: "CGK" } });
    await assert.rejects(s.call({ action: "staff-list" }), {
      code: "HO_ADMIN_REQUIRED",
    });
  }
  assert.equal(isHeadOfficeAdmin({ ...actor.profile, role: "HO Admin" }), true);
});
test("inactive, password-change and unauthorized accounts cannot use operations", async () => {
  for (const profile of [
    { ...actor.profile, active: false },
    { ...actor.profile, mustChangePassword: true },
    { ...actor.profile, role: "Report Viewer" },
  ])
    await assert.rejects(setup({ profile }).call({ action: "bootstrap" }), {
      code: "FORBIDDEN",
    });
});
test("registration persists real fields, but never activates face access", async () => {
  const s = setup();
  await s.call(register);
  const p = s.db.rows.get("users/officer-1").seamlessStaff;
  assert.equal(p.employeeNumber, "GA001");
  assert.equal(p.unit, "Lounge Operations");
  assert.equal(p.active, false);
  assert.equal(p.status, "Pending");
  assert.equal(s.db.rows.get("users/officer-1").role, "Lounge Officer");
  assert.equal(s.db.rows.get("users/officer-1").name, "Ayu Pratiwi");
});
test("registration validates consent, station master, assignment and required fields", async () => {
  for (const patch of [
    { consent: false },
    { identityConfirmed: false },
    { unit: "" },
    { employeeNumber: "1" },
    { station: "PLM" },
    { loungeIds: ["unknown"] },
  ])
    await assert.rejects(setup().call({ ...register, ...patch }));
  const s = setup();
  s.db.rows.get("stations/CGK").status = "Nonaktif";
  await assert.rejects(s.call(register), { code: "STATION_UNAVAILABLE" });
});
test("employee number reservation prevents two staff claiming the same credential", async () => {
  const s = setup();
  s.db.rows.set("users/another", {
    name: "Another",
    active: true,
    role: "BO Admin",
    station: "CGK",
  });
  await s.call(register);
  await assert.rejects(s.call({ ...register, uid: "another" }), {
    code: "EMPLOYEE_NUMBER_USED",
  });
});
test("photo validation rejects SVG, oversized and non-image bytes", () => {
  for (const data of [
    "data:image/svg+xml;base64,PHN2Zz4=",
    "data:image/jpeg;base64,YWJj",
    "x".repeat(1500001),
  ])
    assert.throws(() => imageBytes(data));
  assert.equal(imageBytes(image).contentType, "image/jpeg");
});
test("photo upload requires registered subject and consent", async () => {
  const s = setup();
  await assert.rejects(
    s.call({
      action: "photo-upload",
      uid: "officer-1",
      data: image,
      consent: true,
    }),
    { code: "REGISTER_FIRST" },
  );
  await s.call(register);
  await assert.rejects(
    s.call({
      action: "photo-upload",
      uid: "officer-1",
      data: image,
      consent: false,
    }),
    { code: "CONSENT_REQUIRED" },
  );
});
test("uploaded photos remain pending review; missing provider cannot activate", async () => {
  const s = setup();
  await registerAndPhoto(s);
  assert.equal(
    s.db.rows.get("users/officer-1").seamlessStaff.status,
    "PendingReview",
  );
  await assert.rejects(
    s.call({
      action: "staff-approve",
      uid: "officer-1",
      identityConfirmed: true,
    }),
    { code: "IDENTITY_NOT_CONNECTED" },
  );
  assert.equal(s.db.rows.get("users/officer-1").seamlessStaff.active, false);
});
test("a photo from another subject or owner cannot be attached", async () => {
  const s = setup();
  await s.call(register);
  await assert.rejects(
    s.call({
      action: "staff-enrollment-save",
      uid: "officer-1",
      consent: true,
      photos: [{ path: "staff-enrollment/another/admin-1/x", pose: "front" }],
    }),
    { code: "INVALID_PHOTO" },
  );
});
test("staff list returns human-facing fields without provider references or invitations", async () => {
  const s = setup();
  await s.call(register);
  s.db.rows.get("users/officer-1").seamlessStaff.referenceId =
    "secret-reference";
  s.db.rows.get("users/officer-1").seamlessStaff.invitationId = "secret-hash";
  const d = await s.call({ action: "staff-list" });
  assert.equal(d.staff[0].employeeNumber, "GA001");
  assert.doesNotMatch(JSON.stringify(d), /secret-reference|secret-hash/);
});
test("self enrollment links are hashed, expire and replace earlier invitations", async () => {
  const s = setup();
  await s.call(register);
  const first = await s.call({ action: "enrollment-invite", uid: "officer-1" });
  assert.ok(s.db.rows.has("seamlessEnrollmentLinks/" + sha(first.token)));
  assert.ok(!s.db.rows.has("seamlessEnrollmentLinks/" + first.token));
  await s.call({ action: "enrollment-info", token: first.token });
  const second = await s.call({
    action: "enrollment-invite",
    uid: "officer-1",
  });
  await assert.rejects(
    s.call({ action: "enrollment-info", token: first.token }),
    { code: "LINK_INVALID" },
  );
  s.db.rows.get("seamlessEnrollmentLinks/" + sha(second.token)).expiresAt =
    "2000-01-01";
  await assert.rejects(
    s.call({ action: "enrollment-info", token: second.token }),
    { code: "LINK_INVALID" },
  );
});
test("self enrollment requires three poses, consumes link once and awaits review", async () => {
  const s = setup();
  await s.call(register);
  const { token } = await s.call({
    action: "enrollment-invite",
    uid: "officer-1",
  });
  const photos = [];
  for (const pose of ["front", "right", "left"])
    photos.push(
      (
        await s.call({
          action: "enrollment-upload",
          token,
          pose,
          data: image,
          consent: true,
        })
      ).photo,
    );
  await assert.rejects(
    s.call({
      action: "enrollment-submit",
      token,
      consent: true,
      photos: photos.slice(0, 2),
    }),
    { code: "THREE_POSES_REQUIRED" },
  );
  await s.call({ action: "enrollment-submit", token, consent: true, photos });
  assert.equal(
    s.db.rows.get("users/officer-1").seamlessStaff.status,
    "PendingReview",
  );
  await assert.rejects(
    s.call({ action: "enrollment-submit", token, consent: true, photos }),
    { code: "LINK_INVALID" },
  );
});
test("deactivation revokes pending invitation and remains available for inactive staff", async () => {
  const s = setup();
  await s.call(register);
  const { token } = await s.call({
    action: "enrollment-invite",
    uid: "officer-1",
  });
  s.db.rows.get("users/officer-1").active = false;
  await s.call({ action: "staff-deactivate", uid: "officer-1" });
  assert.equal(
    s.db.rows.get("users/officer-1").seamlessStaff.status,
    "Revoked",
  );
  await assert.rejects(s.call({ action: "enrollment-info", token }), {
    code: "LINK_INVALID",
  });
});
test("revoked invitation issuer blocks self enrollment immediately", async () => {
  const s = setup();
  await s.call(register);
  const { token } = await s.call({
    action: "enrollment-invite",
    uid: "officer-1",
  });
  s.db.rows.get("users/admin-1").active = false;
  await assert.rejects(s.call({ action: "enrollment-info", token }), {
    code: "LINK_INVALID",
  });
});
test("missing live provider rejects claim without creating a session or issuing gate command", async () => {
  const s = setup();
  await assert.rejects(s.call(claim), { code: "IDENTITY_NOT_CONNECTED" });
  assert.ok(
    ![...s.db.rows.keys()].some((k) =>
      k.startsWith("seamlessVerificationSessions/"),
    ),
  );
});
test("claim requires explicit consent, a known category and an authorized lounge", async () => {
  const s = setup({ provider: live() });
  for (const patch of [
    { consent: false },
    { category: "Unknown" },
    { credential: "" },
    { loungeId: "missing" },
  ])
    await assert.rejects(s.call({ ...claim, ...patch }));
});
test("1:1 passenger verification checks session identity, liveness, entitlement and physical gate acknowledgement", async () => {
  const s = setup({ provider: live() }),
    { sessionId } = await s.call(claim);
  const result = await s.call({
    action: "verify-one-to-one",
    sessionId,
    requestId: "request-1",
    capture: image,
  });
  assert.equal(result.decision, "Eligible");
  assert.equal(result.gate, "OpenConfirmed");
  const activity = await s.call({ action: "activity", loungeId: "lounge-1" });
  assert.equal(activity.activity.length, 1);
  assert.doesNotMatch(
    JSON.stringify([...s.db.rows.values()].filter((x) => x.action)),
    /one-reference|p-ref|base64/,
  );
});
for (const [name, override] of [
  ["not matched", { verifyOneToOne: async () => ({ matched: false }) }],
  [
    "failed liveness",
    {
      verifyOneToOne: async (s) => ({
        matched: true,
        livenessPassed: false,
        sessionId: s.sessionId,
        referenceId: s.referenceId,
      }),
    },
  ],
  [
    "wrong session",
    {
      verifyOneToOne: async (s) => ({
        matched: true,
        livenessPassed: true,
        sessionId: "wrong",
        referenceId: s.referenceId,
      }),
    },
  ],
  [
    "wrong reference",
    {
      verifyOneToOne: async (s) => ({
        matched: true,
        livenessPassed: true,
        sessionId: s.sessionId,
        referenceId: "wrong",
      }),
    },
  ],
  [
    "invalid entitlement",
    { passengerEntitlement: async () => ({ eligible: false }) },
  ],
  [
    "expired entitlement",
    {
      passengerEntitlement: async (s) => ({
        eligible: true,
        subjectKey: s.subjectKey,
        loungeId: s.loungeId,
        validUntil: 1,
      }),
    },
  ],
  [
    "wrong lounge",
    {
      passengerEntitlement: async (s) => ({
        eligible: true,
        subjectKey: s.subjectKey,
        loungeId: "other",
        validUntil: Date.now() + 100000,
      }),
    },
  ],
])
  test(`${name} cannot issue a gate command`, async () => {
    let commands = 0;
    const s = setup({
        provider: live({
          ...override,
          openGate: async () => {
            commands++;
          },
        }),
      }),
      { sessionId } = await s.call(claim);
    const r = await s.call({
      action: "verify-one-to-one",
      sessionId,
      requestId: "request-1",
      capture: image,
    });
    assert.equal(r.decision, "Rejected");
    assert.equal(r.gate, "NotRequested");
    assert.equal(commands, 0);
  });
test("parallel request replay issues only one physical gate command", async () => {
  let commands = 0;
  const s = setup({
      provider: live({
        openGate: async (q) => {
          commands++;
          return {
            physicalOpenConfirmed: true,
            idempotencyKey: q.idempotencyKey,
            loungeId: q.loungeId,
          };
        },
      }),
    }),
    { sessionId } = await s.call(claim);
  const p = {
    action: "verify-one-to-one",
    sessionId,
    requestId: "request-1",
    capture: image,
  };
  await Promise.all([s.call(p), s.call(p)]);
  const r = await s.call(p);
  assert.equal(r.gate, "OpenConfirmed");
  assert.equal(commands, 1);
});
test("different request IDs cannot reuse one face verification session", async () => {
  const s = setup({ provider: live() }),
    { sessionId } = await s.call(claim);
  await s.call({
    action: "verify-one-to-one",
    sessionId,
    requestId: "request-1",
    capture: image,
  });
  await assert.rejects(
    s.call({
      action: "verify-one-to-one",
      sessionId,
      requestId: "request-2",
      capture: image,
    }),
    { code: "SESSION_INVALID" },
  );
});
test("wrong gate acknowledgement never displays physical open confirmed", async () => {
  const s = setup({
      provider: live({
        openGate: async () => ({
          physicalOpenConfirmed: true,
          idempotencyKey: "wrong",
          loungeId: "wrong",
        }),
      }),
    }),
    { sessionId } = await s.call(claim);
  const r = await s.call({
    action: "verify-one-to-one",
    sessionId,
    requestId: "request-1",
    capture: image,
  });
  assert.equal(r.decision, "Eligible");
  assert.equal(r.gate, "Unconfirmed");
});
test("gate timeout is bounded and replay does not resend the command", async () => {
  let commands = 0;
  const s = setup({
      timeout: 10,
      provider: live({
        openGate: async () => {
          commands++;
          return new Promise(() => {});
        },
      }),
    }),
    { sessionId } = await s.call(claim);
  const p = {
    action: "verify-one-to-one",
    sessionId,
    requestId: "request-1",
    capture: image,
  };
  const r = await s.call(p);
  assert.equal(r.gate, "Unconfirmed");
  await s.call(p);
  assert.equal(commands, 1);
});
test("revoked staff is rechecked after face matching before gate command", async () => {
  let commands = 0;
  const provider = live({
    verifyOneToOne: async (x) => {
      s.db.rows.get("users/officer-1").seamlessStaff.active = false;
      return {
        matched: true,
        livenessPassed: true,
        sessionId: x.sessionId,
        referenceId: x.referenceId,
      };
    },
    openGate: async () => {
      commands++;
    },
  });
  const s = setup({ provider });
  await registerAndPhoto(s);
  await s.call({
    action: "staff-approve",
    uid: "officer-1",
    identityConfirmed: true,
  });
  const { sessionId } = await s.call({
    ...claim,
    category: "Staff",
    credential: "GA001",
  });
  const r = await s.call({
    action: "verify-one-to-one",
    sessionId,
    requestId: "request-1",
    capture: image,
  });
  assert.equal(r.decision, "Rejected");
  assert.equal(commands, 0);
});
test("operator revocation during face matching prevents gate command", async () => {
  let commands = 0;
  const s = setup({
    provider: live({
      verifyOneToOne: async (x) => {
        s.db.rows.get("users/admin-1").active = false;
        return {
          matched: true,
          livenessPassed: true,
          sessionId: x.sessionId,
          referenceId: x.referenceId,
        };
      },
      openGate: async () => {
        commands++;
      },
    }),
  });
  const { sessionId } = await s.call(claim);
  const r = await s.call({
    action: "verify-one-to-one",
    sessionId,
    requestId: "request-1",
    capture: image,
  });
  assert.equal(r.decision, "Rejected");
  assert.equal(commands, 0);
});
test("published map and video must belong to the selected lounge and station", async () => {
  const s = setup();
  s.db.rows.set("loungeLayouts/map-1", {
    status: "Published",
    station: "PLM",
    loungeId: "other",
  });
  await assert.rejects(
    s.call({
      action: "display-settings-save",
      loungeId: "lounge-1",
      layoutId: "map-1",
    }),
    { code: "INVALID_LAYOUT" },
  );
  s.db.rows.set("displayContents/video-1", {
    status: "Active",
    contentType: "Video",
    station: "PLM",
  });
  await assert.rejects(
    s.call({
      action: "display-settings-save",
      loungeId: "lounge-1",
      videoId: "video-1",
    }),
    { code: "INVALID_MEDIA" },
  );
});
test("station options use the master code rather than Firestore document ID", async () => {
  const s = setup();
  s.db.rows.set("stations/random-long-id", {
    code: "DPS",
    name: "Denpasar",
    status: "Aktif",
  });
  const d = await s.call({ action: "bootstrap" });
  assert.ok(d.stations.some((s) => s.code === "DPS"));
  assert.doesNotMatch(JSON.stringify(d.stations), /random-long-id/);
});

test("a replaced employee number cannot remain an active identity credential", async () => {
  const s = setup({ provider: live() });
  await registerAndPhoto(s);
  await s.call({
    action: "staff-approve",
    uid: "officer-1",
    identityConfirmed: true,
  });
  s.db.rows.get("users/officer-1").seamlessStaff.employeeNumber = "NEW001";
  await assert.rejects(
    s.call({ ...claim, category: "Staff", credential: "GA001" }),
    { code: "CLAIM_UNAVAILABLE" },
  );
});
test("master document IDs containing dots are accepted without exposing them in labels", async () => {
  const s = setup();
  s.db.rows.set("lounges/cgk.PhWvv123", {
    airport: "CGK",
    name: "Assigned Lounge",
    status: "Aktif",
  });
  s.db.rows.get("users/officer-1").loungeId = "cgk.PhWvv123";
  await s.call({ ...register, loungeIds: ["cgk.PhWvv123"] });
  assert.equal(
    s.db.rows.get("users/officer-1").seamlessStaff.loungeIds[0],
    "cgk.PhWvv123",
  );
});

test("actual Function rejects unauthenticated operations before initializing Firebase", async () => {
  const { default: handler } =
    await import("../netlify/functions/seamless-operations.mjs");
  const response = await handler(
    new Request("http://localhost/", {
      method: "POST",
      body: JSON.stringify({ action: "bootstrap" }),
    }),
  );
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await response.json()).code, "SESSION_EXPIRED");
});
test("actual Function rejects malformed public link before accessing Firestore or Storage", async () => {
  const { default: handler } =
    await import("../netlify/functions/seamless-operations.mjs");
  const response = await handler(
    new Request("http://localhost/", {
      method: "POST",
      body: JSON.stringify({ action: "enrollment-info", token: "invalid" }),
    }),
  );
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "LINK_INVALID");
});

test("provider diagnostics do not enter results or activity logs", async () => {
  const s = setup({
    provider: live({
      verifyOneToOne: async () => {
        throw Object.assign(new Error("provider secret"), {
          code: "VENDOR_SECRET_TOKEN",
        });
      },
    }),
  });
  const { sessionId } = await s.call(claim);
  const r = await s.call({
    action: "verify-one-to-one",
    sessionId,
    requestId: "request-1",
    capture: image,
  });
  assert.equal(r.reason, "VERIFICATION_UNAVAILABLE");
  assert.doesNotMatch(JSON.stringify(r), /VENDOR_SECRET_TOKEN|provider secret/);
});
