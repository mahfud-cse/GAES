import { createHash, randomBytes, randomUUID } from "node:crypto";
import { accessError, assertLocation, STAFF_ROLES } from "./core.mjs";

export const OPERATION_ROLES = [
  "Super Admin",
  "Admin",
  "HO Admin",
  "BO Admin",
  "Lounge Officer",
  "Lounge Manager",
];
export const isHeadOfficeAdmin = (profile) =>
  profile?.active === true &&
  ["Super Admin", "Admin", "HO Admin"].includes(profile.role) &&
  profile.station === "ALL" &&
  profile.mustChangePassword !== true;
export const safeOperationCodes = new Set([
  "CLAIM_UNAVAILABLE",
  "CONSENT_REQUIRED",
  "CREDENTIAL_REQUIRED",
  "EMPLOYEE_NUMBER_USED",
  "ENROLLMENT_REJECTED",
  "ENTITLEMENT_INVALID",
  "ENTITLEMENT_NOT_CONNECTED",
  "FACE_VERIFICATION_FAILED",
  "FORBIDDEN",
  "GATE_NOT_CONNECTED",
  "HO_ADMIN_REQUIRED",
  "IDENTITY_NOT_CONNECTED",
  "INVALID_ACTION",
  "INVALID_INPUT",
  "INVALID_LAYOUT",
  "INVALID_MEDIA",
  "INVALID_PHOTO",
  "INVALID_REPOSITORY_PATH",
  "LINK_INVALID",
  "LOUNGE_REQUIRED",
  "METHOD_NOT_ALLOWED",
  "PAYLOAD_TOO_LARGE",
  "PHOTO_REQUIRED",
  "PHOTO_TOO_LARGE",
  "PROVIDER_TIMEOUT",
  "REGISTER_FIRST",
  "REQUEST_CONFLICT",
  "REVIEW_REQUIRED",
  "SERVICE_UNAVAILABLE",
  "SESSION_EXPIRED",
  "SESSION_INVALID",
  "STAFF_CHANGED",
  "STAFF_FIELDS_REQUIRED",
  "STAFF_SCOPE_INVALID",
  "STAFF_UNAVAILABLE",
  "STATION_UNAVAILABLE",
  "STORAGE_NOT_CONNECTED",
  "THREE_POSES_REQUIRED",
]);
const fail = (code, status = 400) => {
  throw Object.assign(accessError(status, code), { code });
};
export const cleanId = (value) =>
  typeof value === "string" &&
  /^[a-zA-Z0-9_-][a-zA-Z0-9_.-]{0,159}$/.test(value)
    ? value
    : fail("INVALID_INPUT");
const text = (v, n = 120) =>
  typeof v === "string" ? v.trim().slice(0, n) : "";
const hash = (v) => createHash("sha256").update(v).digest("hex");
const now = () => new Date().toISOString();
const staffView = (doc) => {
  const s = doc.data(),
    p = s.seamlessStaff || {};
  return {
    uid: doc.id,
    name: p.name || s.name || "",
    unit: p.unit || s.organization || "",
    employeeNumber: p.employeeNumber || "",
    station: s.station,
    role: s.role,
    active: s.active === true,
    loungeId: s.loungeId || "",
    registration: {
      name: p.name || "",
      unit: p.unit || "",
      employeeNumber: p.employeeNumber || "",
      loungeIds: p.loungeIds || [],
      status: p.status || "Pending",
    },
    hasPhoto: !!p.photos?.length,
  };
};
export function imageBytes(data) {
  if (typeof data !== "string" || data.length > 1500000)
    fail("PHOTO_TOO_LARGE", 413);
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(
    data,
  );
  if (!m) fail("INVALID_PHOTO");
  const bytes = Buffer.from(m[2], "base64");
  const valid =
    m[1] === "image/jpeg"
      ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : m[1] === "image/png"
        ? bytes
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : bytes.subarray(0, 4).toString() === "RIFF" &&
          bytes.subarray(8, 12).toString() === "WEBP";
  if (!valid || bytes.length < 100 || bytes.length > 1000000)
    fail("INVALID_PHOTO");
  return { bytes, contentType: m[1] };
}
// An approved integration implements this interface. No simulated approval is used here.
export const unavailableProvider = {
  configured: false,
  async resolveClaim() {
    fail("IDENTITY_NOT_CONNECTED", 503);
  },
  async verifyOneToOne() {
    fail("IDENTITY_NOT_CONNECTED", 503);
  },
  async enroll() {
    fail("IDENTITY_NOT_CONNECTED", 503);
  },
  async passengerEntitlement() {
    fail("ENTITLEMENT_NOT_CONNECTED", 503);
  },
  async openGate() {
    fail("GATE_NOT_CONNECTED", 503);
  },
};
export function createOperationsService({
  authenticate,
  database,
  audit,
  media,
  provider = unavailableProvider,
  rateLimit = async () => {},
  providerTimeoutMs = 8000,
}) {
  const invoke = async (method, input) => {
    let timer;
    const controller = new AbortController();
    try {
      return await Promise.race([
        provider[method]({ ...input, signal: controller.signal }),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(
              Object.assign(new Error("PROVIDER_TIMEOUT"), {
                code: "PROVIDER_TIMEOUT",
              }),
            );
          }, providerTimeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  return async function handle(request) {
    if (request.method !== "POST") fail("METHOD_NOT_ALLOWED", 405);
    const raw = await request.text();
    if (raw.length > 1700000) fail("PAYLOAD_TOO_LARGE", 413);
    let i;
    try {
      i = JSON.parse(raw);
    } catch {
      fail("INVALID_INPUT");
    }
    if (!i || typeof i !== "object" || Array.isArray(i)) fail("INVALID_INPUT");
    let db;
    const a = text(i.action, 40);
    const publicActions = [
      "enrollment-info",
      "enrollment-upload",
      "enrollment-submit",
    ];
    let actor, invitation, invitationRef;
    if (publicActions.includes(a)) {
      if (typeof i.token !== "string" || !/^[a-f0-9]{64}$/.test(i.token))
        fail("LINK_INVALID", 403);
      db = database();
      await rateLimit(request, hash(i.token));
      invitationRef = db
        .collection("seamlessEnrollmentLinks")
        .doc(hash(i.token));
      const s = await invitationRef.get();
      invitation = s.data();
      if (!s.exists || invitation.usedAt || invitation.expiresAt <= now())
        fail("LINK_INVALID", 403);
      const [u, issuer] = await Promise.all([
        db.collection("users").doc(invitation.uid).get(),
        db.collection("users").doc(invitation.issuedBy).get(),
      ]);
      if (
        !u.exists ||
        !u.data().active ||
        !STAFF_ROLES.includes(u.data().role) ||
        u.data().seamlessStaff?.invitationId !== invitationRef.id ||
        !isHeadOfficeAdmin(issuer.data())
      )
        fail("LINK_INVALID", 403);
      actor = { decoded: { uid: invitation.uid }, profile: u.data() };
    } else {
      actor = await authenticate(request);
      if (
        !actor?.decoded?.uid ||
        actor.profile?.active !== true ||
        actor.profile.mustChangePassword === true ||
        !OPERATION_ROLES.includes(actor.profile.role)
      )
        fail("FORBIDDEN", 403);
      db = database();
      await rateLimit(request, actor.decoded.uid);
    }
    const admin = () => {
      if (!isHeadOfficeAdmin(actor.profile)) fail("HO_ADMIN_REQUIRED", 403);
    };
    const refFor = (uid) => db.collection("users").doc(cleanId(uid));
    const subject = async (uid) => {
      const s = await refFor(uid).get();
      if (!s.exists || !STAFF_ROLES.includes(s.data().role) || !s.data().active)
        fail("STAFF_UNAVAILABLE", 409);
      return s;
    };
    const scope = async (s, loungeIds) => {
      if (
        !Array.isArray(loungeIds) ||
        !loungeIds.length ||
        loungeIds.length > 30
      )
        fail("LOUNGE_REQUIRED");
      const ids = [...new Set(loungeIds.map(cleanId))];
      const all = await Promise.all(
        ids.map((id) => db.collection("lounges").doc(id).get()),
      );
      if (
        all.some(
          (l) =>
            !l.exists ||
            l.data().status !== "Aktif" ||
            l.data().sourceStatus === "SOURCE_NOT_FOUND" ||
            l.data().airport !== s.station ||
            (["Lounge Officer", "Lounge Manager"].includes(s.role) &&
              s.loungeId !== l.id),
        )
      )
        fail("STAFF_SCOPE_INVALID", 409);
      return ids;
    };
    const updateProfile = async (uid, expected, data, action) => {
      await db.runTransaction(async (tx) => {
        const [u, acting] = await Promise.all([
          tx.get(refFor(uid)),
          tx.get(refFor(actor.decoded.uid)),
        ]);
        if (
          !u.exists ||
          JSON.stringify(u.data().seamlessStaff || {}) !==
            JSON.stringify(expected || {})
        )
          fail("STAFF_CHANGED", 409);
        if (!publicActions.includes(a) && !isHeadOfficeAdmin(acting.data()))
          fail("HO_ADMIN_REQUIRED", 403);
        if (
          data.status !== "Revoked" &&
          (!u.data().active ||
            !STAFF_ROLES.includes(u.data().role) ||
            u.data().station !== data.station)
        )
          fail("STAFF_CHANGED", 409);
        if (data.status === "Active") {
          const scoped = await Promise.all(
            data.loungeIds.map((id) =>
              tx.get(db.collection("lounges").doc(id)),
            ),
          );
          if (
            scoped.some(
              (l) =>
                !l.exists ||
                l.data().status !== "Aktif" ||
                l.data().sourceStatus === "SOURCE_NOT_FOUND" ||
                l.data().airport !== u.data().station ||
                (["Lounge Officer", "Lounge Manager"].includes(u.data().role) &&
                  u.data().loungeId !== l.id),
            )
          )
            fail("STAFF_CHANGED", 409);
        }
        tx.update(refFor(uid), { seamlessStaff: data });
        audit(tx, db, actor, {
          action,
          module: "Seamless Access",
          station: u.data().station,
          targetId: uid,
          result: data.status,
          detail:
            "Staff registration metadata updated; no biometric material in audit.",
        });
      });
    };
    if (a === "bootstrap") {
      const [stations, contents, layouts] = await Promise.all([
        db.collection("stations").get(),
        db.collection("displayContents").get(),
        db.collection("loungeLayouts").get(),
      ]);
      return {
        canManage: isHeadOfficeAdmin(actor.profile),
        integration: {
          identity: provider.configured === true,
          entitlement: provider.entitlementConfigured === true,
          gate: provider.gateConfigured === true,
        },
        stations: stations.docs
          .map((s) => s.data())
          .filter(
            (s) =>
              s.status === "Aktif" &&
              s.sourceStatus !== "SOURCE_NOT_FOUND" &&
              (["Super Admin", "Admin", "HO Admin"].includes(
                actor.profile.role,
              ) ||
                s.code === actor.profile.station),
          )
          .map((s) => ({ code: s.code, name: s.name })),
        videos: contents.docs
          .filter(
            (s) =>
              (s.data().status === "Active" &&
                s.data().contentType === "Video" &&
                ["ALL", actor.profile.station].includes(s.data().station)) ||
              (isHeadOfficeAdmin(actor.profile) &&
                s.data().status === "Active" &&
                s.data().contentType === "Video"),
          )
          .map((s) => ({
            id: s.id,
            title: s.data().title,
            sourceUrl: s.data().sourceUrl,
            station: s.data().station,
          }))
          .filter(
            (s) =>
              /^https:\/\//.test(s.sourceUrl) ||
              (/^\/(?!\/)[\w./-]+$/.test(s.sourceUrl) &&
                !s.sourceUrl.includes("..")),
          ),
        layouts: layouts.docs
          .filter(
            (s) =>
              s.data().status === "Published" &&
              (["Super Admin", "Admin", "HO Admin"].includes(
                actor.profile.role,
              ) ||
                s.data().station === actor.profile.station),
          )
          .map((s) => ({
            id: s.id,
            loungeId: s.data().loungeId,
            title: s.data().title,
            station: s.data().station,
          })),
      };
    }
    if (["display-settings", "display-settings-save"].includes(a)) {
      const loungeId = cleanId(i.loungeId),
        l = await db.collection("lounges").doc(loungeId).get();
      assertLocation(actor, l.exists ? { ...l.data(), id: l.id } : null);
      const ref = db.collection("seamlessDisplaySettings").doc(loungeId);
      if (a === "display-settings-save") {
        admin();
        const videoId = i.videoId ? cleanId(i.videoId) : "",
          layoutId = i.layoutId ? cleanId(i.layoutId) : "";
        if (videoId) {
          const v = await db.collection("displayContents").doc(videoId).get();
          if (
            !v.exists ||
            v.data().status !== "Active" ||
            v.data().contentType !== "Video" ||
            !["ALL", l.data().airport].includes(v.data().station)
          )
            fail("INVALID_MEDIA", 409);
        }
        if (layoutId) {
          const m = await db.collection("loungeLayouts").doc(layoutId).get();
          if (
            !m.exists ||
            m.data().status !== "Published" ||
            m.data().loungeId !== loungeId ||
            m.data().station !== l.data().airport
          )
            fail("INVALID_LAYOUT", 409);
        }
        await db.runTransaction(async (tx) => {
          tx.set(ref, {
            videoId,
            layoutId,
            station: l.data().airport,
            updatedAt: now(),
          });
          audit(tx, db, actor, {
            action: "SEAMLESS_DISPLAY_SETTINGS",
            module: "Seamless Access",
            loungeId,
            station: l.data().airport,
            result: "Saved",
          });
        });
      }
      const current = await ref.get();
      return { settings: current.data() || { videoId: "", layoutId: "" } };
    }
    if (a === "staff-list") {
      admin();
      let q = db.collection("users").orderBy("__name__").limit(101);
      if (i.cursor) q = q.startAfter(cleanId(i.cursor));
      const rows = (await q.get()).docs;
      return {
        staff: rows
          .slice(0, 100)
          .filter((s) => STAFF_ROLES.includes(s.data().role))
          .map(staffView),
        nextCursor: rows.length > 100 ? rows[99].id : null,
      };
    }
    if (a === "staff-register") {
      admin();
      const s = await subject(i.uid),
        p = s.data().seamlessStaff || {};
      const name = text(i.name),
        unit = text(i.unit),
        employeeNumber = text(i.employeeNumber, 40),
        station = text(i.station, 12);
      if (!name || !unit || !/^[A-Za-z0-9._-]{2,40}$/.test(employeeNumber))
        fail("STAFF_FIELDS_REQUIRED");
      if (station !== s.data().station) fail("STAFF_SCOPE_INVALID", 409);
      const st = await db
        .collection("stations")
        .where("code", "==", station)
        .get();
      if (
        !st.docs.some(
          (d) =>
            d.data().status === "Aktif" &&
            d.data().sourceStatus !== "SOURCE_NOT_FOUND",
        )
      )
        fail("STATION_UNAVAILABLE", 409);
      const loungeIds = await scope(s.data(), i.loungeIds);
      if (i.identityConfirmed !== true || i.consent !== true)
        fail("CONSENT_REQUIRED");
      // Employee number uniqueness is reserved in the same transaction as the profile write.
      await db.runTransaction(async (tx) => {
        const key = db
          .collection("seamlessEmployeeNumbers")
          .doc(hash(employeeNumber.toUpperCase()));
        const [current, reservation, acting] = await Promise.all([
          tx.get(refFor(s.id)),
          tx.get(key),
          tx.get(refFor(actor.decoded.uid)),
        ]);
        if (!isHeadOfficeAdmin(acting.data())) fail("HO_ADMIN_REQUIRED", 403);
        if (JSON.stringify(current.data() || {}) !== JSON.stringify(s.data()))
          fail("STAFF_CHANGED", 409);
        if (reservation.exists && reservation.data().uid !== s.id)
          fail("EMPLOYEE_NUMBER_USED", 409);
        // A changed employee number keeps its old reservation to prevent reassignment of an active credential.
        tx.set(key, { uid: s.id, updatedAt: now() });
        tx.update(refFor(s.id), {
          seamlessStaff: {
            ...p,
            name,
            unit,
            employeeNumber,
            station,
            loungeIds,
            status: "Pending",
            active: false,
            referenceId: "",
            invitationId: "",
            consentAt: now(),
            identityConfirmedAt: now(),
            updatedAt: now(),
            updatedBy: actor.decoded.uid,
          },
        });
        audit(tx, db, actor, {
          action: "SEAMLESS_STAFF_REGISTER",
          module: "Seamless Access",
          station,
          targetId: s.id,
          result: "Pending",
        });
      });
      return { status: "Pending" };
    }
    if (a === "enrollment-invite") {
      admin();
      const s = await subject(i.uid),
        p = s.data().seamlessStaff;
      if (!p?.employeeNumber) fail("REGISTER_FIRST", 409);
      const token = randomBytes(32).toString("hex"),
        key = hash(token),
        expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      await db.runTransaction(async (tx) => {
        const [u, acting] = await Promise.all([
          tx.get(refFor(s.id)),
          tx.get(refFor(actor.decoded.uid)),
        ]);
        if (!isHeadOfficeAdmin(acting.data())) fail("HO_ADMIN_REQUIRED", 403);
        if (JSON.stringify(u.data().seamlessStaff) !== JSON.stringify(p))
          fail("STAFF_CHANGED", 409);
        tx.create(db.collection("seamlessEnrollmentLinks").doc(key), {
          uid: s.id,
          issuedBy: actor.decoded.uid,
          expiresAt,
          createdAt: now(),
        });
        tx.update(refFor(s.id), {
          seamlessStaff: { ...p, invitationId: key, updatedAt: now() },
        });
        audit(tx, db, actor, {
          action: "SEAMLESS_ENROLLMENT_INVITE",
          module: "Seamless Access",
          targetId: s.id,
          result: "Issued",
        });
      });
      return { token, expiresAt };
    }
    if (a === "enrollment-info")
      return {
        name: actor.profile.seamlessStaff?.name || actor.profile.name,
        station: actor.profile.station,
        expiresAt: invitation.expiresAt,
      };
    if (["photo-upload", "photo-repository", "enrollment-upload"].includes(a)) {
      const self = a === "enrollment-upload";
      if (!self) admin();
      const uid = self ? invitation.uid : cleanId(i.uid);
      const s = await subject(uid);
      if (!s.data().seamlessStaff?.employeeNumber) fail("REGISTER_FIRST", 409);
      if (i.consent !== true) fail("CONSENT_REQUIRED");
      const image =
        a === "photo-repository"
          ? await media.repository(text(i.folder, 200), text(i.file, 120))
          : imageBytes(i.data);
      const pose = ["front", "left", "right"].includes(i.pose)
        ? i.pose
        : "front";
      const owner = self ? invitationRef.id : actor.decoded.uid;
      const path = `staff-enrollment/${uid}/${owner}/${randomUUID()}`;
      await media.save(path, image, { uid, owner, pose });
      return { photo: { path, pose, owner } };
    }
    if (["enrollment-submit", "staff-enrollment-save"].includes(a)) {
      const self = a === "enrollment-submit";
      if (!self) admin();
      const uid = self ? invitation.uid : cleanId(i.uid),
        s = await subject(uid),
        p = s.data().seamlessStaff;
      if (!p?.employeeNumber) fail("REGISTER_FIRST", 409);
      if (i.consent !== true) fail("CONSENT_REQUIRED");
      if (!Array.isArray(i.photos) || !i.photos.length || i.photos.length > 3)
        fail("PHOTO_REQUIRED");
      const owner = self ? invitationRef.id : actor.decoded.uid;
      const photos = [];
      for (const photo of i.photos) {
        if (
          typeof photo.path !== "string" ||
          !photo.path.startsWith(`staff-enrollment/${uid}/${owner}/`) ||
          !["front", "left", "right"].includes(photo.pose)
        )
          fail("INVALID_PHOTO");
        const meta = await media.validate(photo.path);
        if (
          meta.uid !== uid ||
          meta.owner !== owner ||
          meta.pose !== photo.pose
        )
          fail("INVALID_PHOTO");
        photos.push({ path: photo.path, pose: photo.pose });
      }
      if (
        self &&
        (!["front", "left", "right"].every((pose) =>
          photos.some((p) => p.pose === pose),
        ) ||
          new Set(photos.map((p) => p.path)).size !== 3)
      )
        fail("THREE_POSES_REQUIRED");
      const next = {
        ...p,
        photos,
        status: "PendingReview",
        active: false,
        referenceId: "",
        consentAt: now(),
        submittedAt: now(),
        updatedAt: now(),
        updatedBy: actor.decoded.uid,
      };
      if (self) {
        await db.runTransaction(async (tx) => {
          const [link, u, issuer] = await Promise.all([
            tx.get(invitationRef),
            tx.get(refFor(uid)),
            tx.get(refFor(invitation.issuedBy)),
          ]);
          if (
            !link.exists ||
            link.data().usedAt ||
            link.data().expiresAt <= now() ||
            !u.data().active ||
            u.data().seamlessStaff?.invitationId !== invitationRef.id ||
            !isHeadOfficeAdmin(issuer.data())
          )
            fail("LINK_INVALID", 403);
          tx.update(refFor(uid), { seamlessStaff: next });
          tx.update(invitationRef, { usedAt: now() });
          audit(tx, db, actor, {
            action: "SEAMLESS_ENROLLMENT_SUBMITTED",
            module: "Seamless Access",
            targetId: uid,
            result: "PendingReview",
          });
        });
      } else await updateProfile(uid, p, next, "SEAMLESS_ENROLLMENT_SUBMITTED");
      return { status: "PendingReview" };
    }
    if (["staff-approve", "staff-deactivate", "staff-photo"].includes(a)) {
      admin();
      const uid = cleanId(i.uid),
        s = await refFor(uid).get();
      if (!s.exists) fail("STAFF_UNAVAILABLE", 404);
      const p = s.data().seamlessStaff || {};
      if (a === "staff-photo") {
        const photo = p.photos?.[0];
        if (!photo) fail("PHOTO_REQUIRED");
        return { url: await media.readUrl(photo.path) };
      }
      if (a === "staff-deactivate") {
        await updateProfile(
          uid,
          p,
          {
            ...p,
            status: "Revoked",
            active: false,
            referenceId: "",
            invitationId: "",
            updatedAt: now(),
          },
          "SEAMLESS_STAFF_REVOKED",
        );
        return { status: "Revoked" };
      }
      await subject(uid);
      await scope(s.data(), p.loungeIds);
      if (
        p.status !== "PendingReview" ||
        !p.photos?.length ||
        !p.consentAt ||
        i.identityConfirmed !== true
      )
        fail("REVIEW_REQUIRED", 409);
      // Uploading images alone never activates biometric access.
      if (!provider.configured) fail("IDENTITY_NOT_CONNECTED", 503);
      const enrolled = await invoke("enroll", {
        subjectKey: uid,
        photos: p.photos,
        consentAt: p.consentAt,
        mode: "ONE_TO_ONE",
      });
      if (enrolled?.verified !== true || !text(enrolled.referenceId, 200))
        fail("ENROLLMENT_REJECTED", 409);
      await updateProfile(
        uid,
        p,
        {
          ...p,
          status: "Active",
          active: true,
          referenceId: enrolled.referenceId,
          invitationId: "",
          approvedAt: now(),
          approvedBy: actor.decoded.uid,
          updatedAt: now(),
        },
        "SEAMLESS_STAFF_APPROVED",
      );
      return { status: "Active" };
    }
    if (a === "activity") {
      const loungeId = cleanId(i.loungeId),
        l = await db.collection("lounges").doc(loungeId).get();
      assertLocation(actor, l.exists ? { ...l.data(), id: l.id } : null);
      let q = db
        .collection("seamlessAccessLocations")
        .doc(loungeId)
        .collection("attempts")
        .orderBy("createdAt", "desc")
        .limit(51);
      if (i.cursor) {
        const c = await db
          .collection("seamlessAccessLocations")
          .doc(loungeId)
          .collection("attempts")
          .doc(cleanId(i.cursor))
          .get();
        if (!c.exists) fail("INVALID_INPUT");
        q = q.startAfter(c);
      }
      const rows = (await q.get()).docs;
      return {
        activity: rows.slice(0, 50).map((s) => s.data()),
        nextCursor: rows.length > 50 ? rows[49].id : null,
      };
    }
    if (a === "claim") {
      if (i.consent !== true) fail("CONSENT_REQUIRED");
      const loungeId = cleanId(i.loungeId),
        l = await db.collection("lounges").doc(loungeId).get();
      assertLocation(actor, l.exists ? { ...l.data(), id: l.id } : null);
      if (!provider.configured) fail("IDENTITY_NOT_CONNECTED", 503);
      if (
        !["Staff", "Passenger"].includes(i.category) ||
        !text(i.credential, 300)
      )
        fail("CREDENTIAL_REQUIRED");
      let claim;
      if (i.category === "Staff") {
        const idx = await db
          .collection("seamlessEmployeeNumbers")
          .doc(hash(text(i.credential, 40).toUpperCase()))
          .get();
        if (!idx.exists) fail("CLAIM_UNAVAILABLE", 409);
        const s = await subject(idx.data().uid),
          p = s.data().seamlessStaff;
        if (
          !p?.active ||
          p.employeeNumber.toUpperCase() !==
            text(i.credential, 40).toUpperCase() ||
          p.status !== "Active" ||
          !p.referenceId ||
          !p.loungeIds.includes(loungeId) ||
          p.station !== l.data().airport ||
          (["Lounge Officer", "Lounge Manager"].includes(s.data().role) &&
            s.data().loungeId !== loungeId)
        )
          fail("CLAIM_UNAVAILABLE", 409);
        claim = {
          subjectKey: s.id,
          referenceId: p.referenceId,
          category: "Staff",
          displayName: p.name.split(/\s+/)[0],
          unit: p.unit,
          staffRevision: p.updatedAt,
        };
      } else {
        if (!provider.entitlementConfigured)
          fail("ENTITLEMENT_NOT_CONNECTED", 503);
        claim = await invoke("resolveClaim", {
          credential: text(i.credential, 300),
          loungeId,
          station: l.data().airport,
          mode: "ONE_TO_ONE",
        });
        if (
          !claim?.referenceId ||
          !claim.subjectKey ||
          claim.category !== "Passenger"
        )
          fail("CLAIM_UNAVAILABLE", 409);
        claim = {
          subjectKey: claim.subjectKey,
          referenceId: claim.referenceId,
          category: "Passenger",
          displayName: text(claim.displayName, 40).split(/\s+/)[0],
          flight: text(claim.flight, 20),
        };
      }
      const sessionId = randomBytes(24).toString("hex");
      await db.runTransaction(async (tx) =>
        tx.create(
          db.collection("seamlessVerificationSessions").doc(sessionId),
          {
            ...claim,
            loungeId,
            actorId: actor.decoded.uid,
            consentAt: now(),
            expiresAt: new Date(Date.now() + 120000).toISOString(),
            status: "Ready",
          },
        ),
      );
      return { sessionId, expiresIn: 120 };
    }
    if (a === "verify-one-to-one") {
      const sessionId = cleanId(i.sessionId),
        requestId = cleanId(i.requestId),
        sr = db.collection("seamlessVerificationSessions").doc(sessionId);
      const session = await sr.get(),
        s = session.data();
      if (!session.exists || s.actorId !== actor.decoded.uid)
        fail("SESSION_INVALID", 403);
      const key = hash(`${actor.decoded.uid}|${requestId}`),
        attempt = db
          .collection("seamlessAccessLocations")
          .doc(s.loungeId)
          .collection("attempts")
          .doc(key);
      const l = await db.collection("lounges").doc(s.loungeId).get();
      assertLocation(actor, l.exists ? { ...l.data(), id: l.id } : null);
      const reservation = await db.runTransaction(async (tx) => {
        const [current, prev] = await Promise.all([
          tx.get(sr),
          tx.get(attempt),
        ]);
        if (prev.exists) {
          if (prev.data().sessionId !== sessionId)
            fail("REQUEST_CONFLICT", 409);
          return prev.data();
        }
        if (
          current.data().status !== "Ready" ||
          current.data().expiresAt <= now()
        )
          fail("SESSION_INVALID", 409);
        tx.update(sr, { status: "Processing" });
        tx.create(attempt, {
          id: key,
          sessionId,
          status: "Processing",
          createdAt: now(),
          category: s.category,
          decision: "Pending",
          gate: "NotRequested",
        });
        return null;
      });
      if (reservation) return reservation;
      let result = {
        id: key,
        sessionId,
        status: "Complete",
        createdAt: now(),
        category: s.category,
        decision: "Rejected",
        gate: "NotRequested",
        reason: "VERIFICATION_UNAVAILABLE",
      };
      try {
        if (!provider.configured) fail("IDENTITY_NOT_CONNECTED", 503);
        const capture = imageBytes(i.capture);
        const v = await invoke("verifyOneToOne", {
          sessionId,
          referenceId: s.referenceId,
          subjectKey: s.subjectKey,
          capture,
          consentAt: s.consentAt,
          mode: "ONE_TO_ONE",
        });
        if (
          v?.matched !== true ||
          v.livenessPassed !== true ||
          v.sessionId !== sessionId ||
          v.referenceId !== s.referenceId
        )
          fail("FACE_VERIFICATION_FAILED", 409);
        const actorNow = await db
          .collection("users")
          .doc(actor.decoded.uid)
          .get();
        if (
          !actorNow.data()?.active ||
          actorNow.data().mustChangePassword ||
          !OPERATION_ROLES.includes(actorNow.data().role)
        )
          fail("FORBIDDEN", 403);
        const currentLounge = await db
          .collection("lounges")
          .doc(s.loungeId)
          .get();
        assertLocation(
          { decoded: actor.decoded, profile: actorNow.data() },
          currentLounge.exists
            ? { ...currentLounge.data(), id: s.loungeId }
            : null,
        );
        if (s.category === "Staff") {
          const u = await subject(s.subjectKey),
            p = u.data().seamlessStaff;
          if (
            !p?.active ||
            p.status !== "Active" ||
            p.updatedAt !== s.staffRevision ||
            p.referenceId !== s.referenceId ||
            !p.loungeIds.includes(s.loungeId) ||
            u.data().station !== currentLounge.data().airport ||
            (["Lounge Officer", "Lounge Manager"].includes(u.data().role) &&
              u.data().loungeId !== s.loungeId)
          )
            fail("STAFF_SCOPE_INVALID", 409);
        } else {
          const e = await invoke("passengerEntitlement", {
            subjectKey: s.subjectKey,
            loungeId: s.loungeId,
            station: l.data().airport,
          });
          if (
            e?.eligible !== true ||
            e.loungeId !== s.loungeId ||
            e.subjectKey !== s.subjectKey ||
            !Number.isFinite(e.validUntil) ||
            e.validUntil <= Date.now()
          )
            fail("ENTITLEMENT_INVALID", 409);
        }
        result = {
          ...result,
          decision: "Eligible",
          reason: "",
          displayName: s.displayName,
          unit: s.unit || "",
          flight: s.flight || "",
        };
        if (!provider.gateConfigured)
          result = {
            ...result,
            gate: "Unavailable",
            reason: "GATE_NOT_CONNECTED",
          };
        else {
          // Persist command intention first. An uncertain command is never automatically resent.
          await db.runTransaction(async (tx) =>
            tx.update(attempt, {
              ...result,
              status: "GatePending",
              gate: "Pending",
            }),
          );
          const g = await invoke("openGate", {
            idempotencyKey: key,
            loungeId: s.loungeId,
            sessionId,
          });
          result = {
            ...result,
            gate:
              g?.physicalOpenConfirmed === true &&
              g.idempotencyKey === key &&
              g.loungeId === s.loungeId
                ? "OpenConfirmed"
                : "Unconfirmed",
          };
        }
      } catch (e) {
        result = {
          ...result,
          reason: safeOperationCodes.has(e.code)
            ? e.code
            : "VERIFICATION_UNAVAILABLE",
          gate: result.decision === "Eligible" ? "Unconfirmed" : "NotRequested",
        };
      }
      await db.runTransaction(async (tx) => {
        tx.update(attempt, result);
        tx.update(sr, { status: "Complete" });
        audit(tx, db, actor, {
          action: "SEAMLESS_ONE_TO_ONE",
          module: "Seamless Access",
          station: l.data().airport,
          loungeId: s.loungeId,
          targetId: key,
          result: result.decision,
          reasonCode: result.reason,
          detail: `Gate: ${result.gate}; no photos or provider references in audit.`,
        });
      });
      return result;
    }
    fail("INVALID_ACTION");
  };
}
