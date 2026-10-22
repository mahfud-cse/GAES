import { createHash } from "node:crypto";
import {
  requirePermission,
  assertLocation,
  accessError,
  evaluateVerification,
  simulateGate,
  STAFF_ROLES,
} from "./core.mjs";
import fixtures from "../../public/demo-media/manifest.json" with { type: "json" };
const id = (value) => {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(value))
    throw accessError(400, "Identifier tidak valid.");
  return value;
};
const digest = (value) => createHash("sha256").update(value).digest("hex");
const staffView = (s) => ({
  uid: s.id,
  name: s.data().name || s.id,
  role: s.data().role,
  station: s.data().station,
  active: s.data().active === true,
  enrollment: s.data().seamlessDemo
    ? {
        mode: "DEMO",
        active: s.data().seamlessDemo.active === true,
        loungeIds: s.data().seamlessDemo.loungeIds || [],
        enrollmentStatus: s.data().seamlessDemo.enrollmentStatus,
        enrolledAt: s.data().seamlessDemo.enrolledAt,
        enrolledBy: s.data().seamlessDemo.enrolledBy,
        createdAt: s.data().seamlessDemo.createdAt,
        updatedAt: s.data().seamlessDemo.updatedAt,
      }
    : null,
});

// Injected dependencies use the existing Firebase/Admin and audit infrastructure.
export function createSeamlessService({
  authenticate,
  database,
  audit,
  rateLimit = async () => {},
}) {
  return async function handle(request) {
    if (request.method !== "POST")
      throw accessError(405, "Method not allowed.");
    const actor = await authenticate(request);
    requirePermission(actor);
    const raw = await request.text();
    if (raw.length > 12000) throw accessError(413, "Payload terlalu besar.");
    let input;
    try {
      input = JSON.parse(raw);
    } catch {
      throw accessError(400, "JSON tidak valid.");
    }
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw accessError(400, "Payload tidak valid.");
    const db = database();
    const action = input.action;
    if (action === "staff-list" || action === "staff-save") {
      requirePermission(actor, true);
      if (action === "staff-list") {
        const pageSize = 100;
        let query = db
          .collection("users")
          .orderBy("__name__")
          .limit(pageSize + 1);
        if (input.cursor) query = query.startAfter(id(input.cursor));
        const rows = (await query.get()).docs;
        return {
          staff: rows.slice(0, pageSize).map(staffView),
          nextCursor: rows.length > pageSize ? rows[pageSize - 1].id : null,
        };
      }
      await rateLimit(request, actor);
      const uid = id(input.uid);
      if (input.privacyConfirmed !== true || input.identityConfirmed !== true)
        throw accessError(
          400,
          "Verifikasi identitas dan otorisasi privasi wajib dikonfirmasi.",
        );
      if (!["enroll", "update", "deactivate"].includes(input.operation))
        throw accessError(400, "Operasi staff tidak valid.");
      if (!Array.isArray(input.loungeIds) || input.loungeIds.length > 30)
        throw accessError(400, "Scope lounge tidak valid.");
      const loungeIds = [...new Set(input.loungeIds.map(id))];
      if (!loungeIds.length && input.operation !== "deactivate")
        throw accessError(400, "Pilih minimal satu lounge.");
      const ref = db.collection("users").doc(uid);
      await db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);
        if (!snapshot.exists)
          throw accessError(
            404,
            "Gunakan akun staff pada User Management terlebih dahulu.",
          );
        const staff = snapshot.data();
        if (
          input.operation !== "deactivate" &&
          !STAFF_ROLES.includes(staff.role)
        )
          throw accessError(
            409,
            "Role staff tidak diizinkan untuk akses operasional.",
          );
        for (const loungeId of input.operation === "deactivate"
          ? []
          : loungeIds) {
          const lounge = await tx.get(db.collection("lounges").doc(loungeId));
          if (
            !lounge.exists ||
            lounge.data().airport !== staff.station ||
            lounge.data().status !== "Aktif" ||
            lounge.data().sourceStatus === "SOURCE_NOT_FOUND"
          )
            throw accessError(
              409,
              "Scope harus memakai lounge aktif pada home station staff.",
            );
          if (
            ["Lounge Officer", "Lounge Manager"].includes(staff.role) &&
            staff.loungeId !== loungeId
          )
            throw accessError(
              409,
              "Scope harus sesuai penugasan lounge staff.",
            );
        }
        const now = new Date().toISOString();
        const previous = staff.seamlessDemo || {};
        if (
          input.operation === "update" &&
          previous.enrollmentStatus !== "Enrolled"
        )
          throw accessError(409, "Staff belum menjalani enrollment demo.");
        const enrollment = {
          mode: "DEMO",
          active: input.operation !== "deactivate",
          loungeIds:
            input.operation === "deactivate"
              ? previous.loungeIds || []
              : loungeIds,
          enrollmentStatus:
            input.operation === "deactivate" ? "Revoked" : "Enrolled",
          providerReference:
            input.operation === "deactivate" ? "" : `DEMO:${uid}`,
          enrolledAt:
            input.operation === "enroll" ? now : previous.enrolledAt || "",
          enrolledBy:
            input.operation === "enroll"
              ? actor.decoded.uid
              : previous.enrolledBy || "",
          privacyConfirmedAt: now,
          identityConfirmedAt: now,
          createdAt: previous.createdAt || now,
          updatedAt: now,
          updatedBy: actor.decoded.uid,
        };
        tx.update(ref, { seamlessDemo: enrollment });
        audit(tx, db, actor, {
          action: `SEAMLESS_DEMO_STAFF_${input.operation}`,
          module: "Seamless Access",
          station: staff.station,
          targetType: "User",
          targetId: uid,
          result: enrollment.enrollmentStatus,
          detail: "DEMO enrollment/reference only; no live biometric captured.",
        });
      });
      return { status: "Saved", mode: "DEMO" };
    }
    if (!["verify", "activity"].includes(action))
      throw accessError(400, "Action tidak valid.");
    const loungeId = id(input.loungeId);
    const snapshot = await db.collection("lounges").doc(loungeId).get();
    const lounge = snapshot.exists
      ? { ...snapshot.data(), id: snapshot.id }
      : null;
    assertLocation(actor, lounge);
    if (action === "activity") {
      // Separate per-lounge collection avoids a composite index and prevents
      // unscoped logs ever being fetched from Firestore.
      let query = db
        .collection("seamlessDemoLocations")
        .doc(loungeId)
        .collection("attempts")
        .orderBy("createdAt", "desc")
        .limit(51);
      if (input.cursor) {
        const c = await db
          .collection("seamlessDemoLocations")
          .doc(loungeId)
          .collection("attempts")
          .doc(id(input.cursor))
          .get();
        if (!c.exists) throw accessError(400, "Cursor tidak tersedia.");
        query = query.startAfter(c);
      }
      const docs = (await query.get()).docs;
      return {
        activity: docs.slice(0, 50).map((s) => s.data()),
        nextCursor: docs.length > 50 ? docs[49].id : null,
      };
    }
    if (!["DEMO", "LIVE"].includes(input.mode))
      throw accessError(400, "Mode wajib DEMO atau LIVE.");
    const requestId = id(input.requestId);
    const gateBehavior = input.gateBehavior || "confirmed";
    if (
      ![
        "confirmed",
        "accepted",
        "timeout",
        "fault",
        "offline",
        "wrong-device",
      ].includes(gateBehavior)
    )
      throw accessError(400, "Skenario gate tidak valid.");
    let fixture = fixtures.find((f) => f.id === input.scenarioId);
    let staff;
    if (input.subjectUid) {
      // Operators must not enumerate real staff records via verification.
      requirePermission(actor, true);
      const staffSnapshot = await db
        .collection("users")
        .doc(id(input.subjectUid))
        .get();
      staff = staffSnapshot.exists ? staffSnapshot.data() : { active: false };
      fixture = {
        id: "managed-staff-demo",
        category: "Staff",
        identity: staffSnapshot.exists ? "matched" : "unknown",
      };
    }
    if (input.mode === "DEMO" && !fixture)
      throw accessError(400, "Skenario demo tidak tersedia.");
    const location = { station: lounge.airport, loungeId };
    const deviceId = `DEMO-${digest(loungeId).slice(0, 16)}`;
    const key = digest(`${actor.decoded.uid}|${requestId}`);
    const fingerprint = digest(
      JSON.stringify([
        loungeId,
        input.mode,
        input.scenarioId || "",
        input.subjectUid || "",
        gateBehavior,
      ]),
    );
    const ref = db.collection("seamlessDemoRequests").doc(key);
    await rateLimit(request, actor);
    const reserved = await db.runTransaction(async (tx) => {
      const previous = await tx.get(ref);
      if (previous.exists) {
        if (previous.data().fingerprint !== fingerprint)
          throw accessError(
            409,
            "Request ID sudah dipakai dengan input berbeda.",
          );
        return previous.data().result
          ? { ...previous.data().result, replayed: true }
          : { status: "PENDING", replayed: true };
      }
      tx.create(ref, {
        fingerprint,
        actorId: actor.decoded.uid,
        loungeId,
        status: "PENDING",
        createdAt: new Date().toISOString(),
      });
      return null;
    });
    if (reserved) return reserved;
    const decision = await evaluateVerification({
      mode: input.mode,
      fixture,
      location,
      staff,
    });
    const gate = simulateGate({
      eligible: decision.decision === "ELIGIBLE",
      behavior: gateBehavior,
      deviceId,
      loungeId,
    });
    const result = {
      ...decision,
      id: key,
      station: lounge.airport,
      loungeId,
      location: lounge.name,
      createdAt: new Date().toISOString(),
      deviceId,
      gate,
      states: [...decision.states, ...gate.trace],
    };
    await db.runTransaction(async (tx) => {
      // Recheck actor, location and managed enrollment immediately before commit.
      const actorNow = await tx.get(
        db.collection("users").doc(actor.decoded.uid),
      );
      requirePermission(
        { decoded: actor.decoded, profile: actorNow.data() },
        Boolean(input.subjectUid),
      );
      const locationNow = await tx.get(db.collection("lounges").doc(loungeId));
      assertLocation(
        { decoded: actor.decoded, profile: actorNow.data() },
        locationNow.exists ? { ...locationNow.data(), id: loungeId } : null,
      );
      if (input.subjectUid) {
        const staffNow = await tx.get(
          db.collection("users").doc(input.subjectUid),
        );
        if (
          JSON.stringify(staffNow.data() || null) !==
          JSON.stringify(staff || null)
        )
          throw accessError(409, "Staff berubah; lakukan verifikasi baru.");
      }
      tx.set(
        db
          .collection("seamlessDemoLocations")
          .doc(loungeId)
          .collection("attempts")
          .doc(key),
        result,
      );
      tx.update(ref, { status: "COMPLETE", result });
      audit(tx, db, actor, {
        action: "SEAMLESS_DEMO_DECISION",
        module: "Seamless Access",
        ...location,
        targetType: "DemoAttempt",
        targetId: key,
        result: result.decision,
        reasonCode: result.reason,
        detail: `${result.mode}; ${result.identity}; ${result.authorization}; synthetic identity only`,
      });
      for (const state of gate.trace)
        audit(tx, db, actor, {
          action: "SEAMLESS_DEMO_GATE",
          module: "Seamless Access",
          ...location,
          targetId: key,
          result: state,
          detail: "SIMULATED device feedback; no physical gate controlled.",
        });
    });
    return result;
  };
}
