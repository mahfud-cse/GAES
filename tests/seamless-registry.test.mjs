import test from "node:test";
import assert from "node:assert/strict";
import { createOperationsService } from "../lib/seamless/operations.mjs";
import { MemoryDB } from "./helpers/seamless-db.mjs";
const photo =
  "data:image/jpeg;base64," +
  Buffer.concat([Buffer.from([255, 216, 255]), Buffer.alloc(200)]).toString(
    "base64",
  );
const fields = {
  action: "registry-save",
  name: "Local Staff",
  unit: "Station Operations",
  employeeNumber: "GA900",
  station: "CGK",
  loungeIds: ["lounge-1"],
  identityConfirmed: true,
  consent: true,
};
function setup(role = "Admin", station = "ALL") {
  const db = new MemoryDB();
  db.rows.set("users/admin-1", { active: true, role, station });
  db.rows.set("stations/CGK", { code: "CGK", status: "Aktif" });
  db.rows.set("stations/PLM", { code: "PLM", status: "Aktif" });
  db.rows.set("lounges/plm-lounge", {
    airport: "PLM",
    name: "Existing Master Lounge",
    status: "Aktif",
  });
  const objects = new Map();
  const handler = createOperationsService({
    database: () => db,
    authenticate: async () => ({
      decoded: { uid: "admin-1" },
      profile: db.rows.get("users/admin-1"),
    }),
    audit: (tx, d, _, r) => tx.set(d.collection("auditLogs").doc(), r),
    media: {
      save: async (path, image, meta) => objects.set(path, meta),
      validate: async (path) => objects.get(path),
      readUrl: async () => "/private-photo",
    },
    provider: {
      configured: true,
      enroll: async () => ({ verified: true, referenceId: "local-reference" }),
      verifyOneToOne: async (s) => ({
        matched: true,
        livenessPassed: false,
        sessionId: s.sessionId,
        referenceId: s.referenceId,
      }),
    },
  });
  return {
    db,
    call: (input) =>
      handler(
        new Request("http://localhost", {
          method: "POST",
          body: JSON.stringify(input),
        }),
      ),
  };
}
test("staff without a portal account can register without creating an Auth/user record", async () => {
  const s = setup(),
    before = [...s.db.rows.keys()].filter((k) => k.startsWith("users/")).length;
  const r = await s.call(fields);
  assert.match(r.uid, /^stf-/);
  assert.ok(s.db.rows.has("seamlessStaffProfiles/" + r.uid));
  assert.equal(
    [...s.db.rows.keys()].filter((k) => k.startsWith("users/")).length,
    before,
  );
  const list = await s.call({ action: "registry-list" });
  assert.equal(list.staff[0].accountUid, "");
});
test("User & Role lookup includes active non-operational accounts and paginates independently", async () => {
  const s = setup();
  s.db.rows.set("users/report-user", {
    name: "Master Data User",
    active: true,
    role: "Report Viewer",
    station: "CGK",
  });
  const d = await s.call({ action: "registry-list" });
  assert.ok(d.accounts.some((a) => a.name === "Master Data User"));
  const skipped = await s.call({ action: "registry-list", skipAccounts: true });
  assert.equal(skipped.accounts.length, 0);
  assert.equal(skipped.accountCursor, null);
});
test("BO can register own station and cannot write another station", async () => {
  const s = setup("BO Admin", "CGK");
  const r = await s.call(fields);
  assert.ok(r.uid);
  await assert.rejects(
    s.call({
      ...fields,
      employeeNumber: "GA901",
      station: "PLM",
      loungeIds: ["plm-lounge"],
    }),
    { code: "STAFF_SCOPE_INVALID" },
  );
});
test("BO lookup excludes other stations and global accounts", async () => {
  const s = setup("BO Admin", "CGK");
  s.db.rows.set("users/outside", {
    name: "Outside",
    role: "Lounge Officer",
    active: true,
    station: "PLM",
  });
  s.db.rows.set("users/global", {
    name: "Global",
    role: "Admin",
    active: true,
    station: "ALL",
  });
  const d = await s.call({ action: "registry-list" });
  assert.ok(!d.accounts.some((a) => ["Outside", "Global"].includes(a.name)));
});
test("optional account links validate existing master users and station scope", async () => {
  const s = setup();
  await assert.rejects(s.call({ ...fields, accountUid: "missing" }), {
    code: "STAFF_SCOPE_INVALID",
  });
  const r = await s.call({ ...fields, accountUid: "officer-1" });
  assert.equal(
    s.db.rows.get("seamlessStaffProfiles/" + r.uid).accountUid,
    "officer-1",
  );
});
test("master lounge ID must exist and match station; no lounge is fabricated", async () => {
  const s = setup();
  await assert.rejects(s.call({ ...fields, loungeIds: ["new-name"] }), {
    code: "STAFF_SCOPE_INVALID",
  });
  assert.ok(!s.db.rows.has("lounges/new-name"));
  await assert.rejects(s.call({ ...fields, loungeIds: ["plm-lounge"] }), {
    code: "STAFF_SCOPE_INVALID",
  });
});
test("existing user enrollment is listed and edited in place", async () => {
  const s = setup();
  s.db.rows.get("users/officer-1").seamlessStaff = {
    name: "Existing",
    employeeNumber: "OLD1",
    station: "CGK",
    loungeIds: ["lounge-1"],
    status: "Pending",
    updatedAt: "before",
  };
  const d = await s.call({ action: "registry-list" });
  assert.ok(d.staff.some((a) => a.uid === "officer-1"));
  await s.call({ ...fields, uid: "officer-1", accountUid: "officer-1" });
  assert.equal(
    s.db.rows.get("users/officer-1").seamlessStaff.employeeNumber,
    "GA900",
  );
  assert.equal(
    [...s.db.rows.keys()].filter((k) => k.startsWith("seamlessStaffProfiles/"))
      .length,
    0,
  );
});
test("independent staff photos, approval and local-engine 1:1 comparison work; liveness absence cannot open a gate", async () => {
  const s = setup();
  const { uid } = await s.call(fields);
  const { photo: p } = await s.call({
    action: "registry-photo-upload",
    uid,
    consent: true,
    data: photo,
  });
  await s.call({
    action: "registry-enrollment-save",
    uid,
    consent: true,
    photos: [p],
  });
  await s.call({ action: "registry-approve", uid, identityConfirmed: true });
  const session = await s.call({
    action: "claim",
    category: "Staff",
    credential: "GA900",
    consent: true,
    loungeId: "lounge-1",
  });
  const next = await s.call({
    action: "display-next-session",
    loungeId: "lounge-1",
  });
  assert.equal(next.sessionId, session.sessionId);
  const r = await s.call({
    action: "verify-one-to-one",
    sessionId: session.sessionId,
    requestId: "test-request",
    capture: photo,
  });
  assert.equal(r.faceMatched, true);
  assert.equal(r.decision, "Rejected");
  assert.equal(r.gate, "NotRequested");
});
test("self enrollment works without a portal account and consumes its scoped invitation once", async () => {
  const s = setup("BO Admin", "CGK");
  const { uid } = await s.call(fields);
  const { token } = await s.call({ action: "registry-invite", uid });
  assert.equal(
    (await s.call({ action: "registry-info", token })).name,
    "Local Staff",
  );
  const photos = [];
  for (const pose of ["front", "right", "left"])
    photos.push(
      (
        await s.call({
          action: "registry-upload",
          token,
          consent: true,
          pose,
          data: photo,
        })
      ).photo,
    );
  await s.call({ action: "registry-submit", token, consent: true, photos });
  await assert.rejects(s.call({ action: "registry-info", token }), {
    code: "LINK_INVALID",
  });
});
test("linked account deactivation prevents future face sessions", async () => {
  const s = setup();
  const { uid } = await s.call({ ...fields, accountUid: "officer-1" });
  const p = s.db.rows.get("seamlessStaffProfiles/" + uid);
  p.seamlessStaff = {
    ...p.seamlessStaff,
    status: "Active",
    active: true,
    referenceId: "ref",
  };
  s.db.rows.get("users/officer-1").active = false;
  await assert.rejects(
    s.call({
      action: "claim",
      category: "Staff",
      credential: "GA900",
      consent: true,
      loungeId: "lounge-1",
    }),
    { code: "STAFF_UNAVAILABLE" },
  );
});
test("anonymous face detection does not create an identity or verification session", async () => {
  const s = setup();
  await assert.rejects(s.call({ action: "detect-face", capture: photo }), {
    code: "IDENTITY_NOT_CONNECTED",
  });
  assert.ok(
    ![...s.db.rows.keys()].some((k) =>
      k.startsWith("seamlessVerificationSessions/"),
    ),
  );
});
