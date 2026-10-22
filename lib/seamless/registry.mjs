import { createHash, randomBytes } from "node:crypto";
import { cleanId, imageBytes, isHeadOfficeAdmin } from "./operations.mjs";
const hash = (s) => createHash("sha256").update(s).digest("hex");
const stamp = () => new Date().toISOString();
const text = (s, n = 120) =>
  typeof s === "string" ? s.trim().slice(0, n) : "";
const fail = (code, status = 400) => {
  throw Object.assign(new Error(code), { code, status });
};
export const registryManager = (p) =>
  p?.active === true &&
  p.mustChangePassword !== true &&
  (isHeadOfficeAdmin(p) || ["BO Admin"].includes(p.role));
export function assertRegistryScope(actor, station, lounges = []) {
  if (!registryManager(actor.profile)) fail("FORBIDDEN", 403);
  if (!isHeadOfficeAdmin(actor.profile) && actor.profile.station !== station)
    fail("STAFF_SCOPE_INVALID", 403);
  if (
    actor.profile.role === "Lounge Manager" &&
    (!actor.profile.loungeId ||
      lounges.some((id) => id !== actor.profile.loungeId))
  )
    fail("STAFF_SCOPE_INVALID", 403);
}
export const staffReference = (db, id) =>
  db
    .collection(id.startsWith("stf-") ? "seamlessStaffProfiles" : "users")
    .doc(cleanId(id));
export const staffRecordView = (s) => {
  const u = s.data(),
    p = u.seamlessStaff || {};
  return {
    uid: s.id,
    accountUid: u.accountUid || (!s.id.startsWith("stf-") ? s.id : ""),
    name: p.name || u.name || "",
    unit: p.unit || u.organization || "",
    employeeNumber: p.employeeNumber || "",
    station: p.station || u.station,
    role: u.role,
    active: u.active === true,
    loungeId: u.loungeId || "",
    registration: {
      employeeNumber: p.employeeNumber || "",
      loungeIds: p.loungeIds || [],
      status: p.status || "Pending",
      updatedAt: p.updatedAt || "",
    },
    hasPhoto: !!p.photos?.length,
  };
};
export function createRegistryService({
  authenticate,
  database,
  audit,
  media,
  provider,
  rateLimit = async () => {},
}) {
  return async (request, input) => {
    const a = input.action,
      publicAction = [
        "registry-info",
        "registry-upload",
        "registry-submit",
      ].includes(a);
    let db, actor, link, linkRef;
    if (publicAction) {
      if (!/^[a-f0-9]{64}$/.test(input.token || "")) fail("LINK_INVALID", 403);
      db = database();
      await rateLimit(request, hash(input.token));
      linkRef = db.collection("seamlessEnrollmentLinks").doc(hash(input.token));
      const snap = await linkRef.get();
      link = snap.data();
      if (
        !snap.exists ||
        link.usedAt ||
        link.expiresAt <= stamp() ||
        link.kind !== "registry"
      )
        fail("LINK_INVALID", 403);
      const [subject, issuer] = await Promise.all([
        staffReference(db, link.uid).get(),
        db.collection("users").doc(link.issuedBy).get(),
      ]);
      if (
        !subject.exists ||
        !subject.data().active ||
        subject.data().seamlessStaff?.invitationId !== linkRef.id
      )
        fail("LINK_INVALID", 403);
      try {
        assertRegistryScope(
          { profile: issuer.data() },
          subject.data().seamlessStaff.station,
          subject.data().seamlessStaff.loungeIds,
        );
      } catch {
        fail("LINK_INVALID", 403);
      }
      actor = { decoded: { uid: link.uid }, profile: subject.data() };
    } else {
      actor = await authenticate(request);
      if (!registryManager(actor.profile)) fail("FORBIDDEN", 403);
      db = database();
      await rateLimit(request, actor.decoded.uid);
    }
    const get = async (id) => {
      const s = await staffReference(db, cleanId(id)).get();
      if (!s.exists) fail("STAFF_UNAVAILABLE", 404);
      if (!publicAction)
        assertRegistryScope(
          actor,
          s.data().seamlessStaff?.station || s.data().station,
          s.data().seamlessStaff?.loungeIds || [],
        );
      return s;
    };
    const log = (tx, id, action, result, station) =>
      audit(tx, db, actor, {
        action,
        module: "Seamless Access",
        station,
        targetId: id,
        result,
      });
    const validateLounges = async (station, ids, tx) => {
      if (!Array.isArray(ids) || !ids.length || ids.length > 30)
        fail("LOUNGE_REQUIRED");
      const lounges = [...new Set(ids.map(cleanId))];
      assertRegistryScope(actor, station, lounges);
      const refs = lounges.map((id) => db.collection("lounges").doc(id));
      const docs = await Promise.all(
        refs.map((r) => (tx ? tx.get(r) : r.get())),
      );
      if (
        docs.some(
          (s) =>
            !s.exists ||
            s.data().airport !== station ||
            s.data().status !== "Aktif" ||
            s.data().sourceStatus === "SOURCE_NOT_FOUND",
        )
      )
        fail("STAFF_SCOPE_INVALID", 409);
      return lounges;
    };
    if (a === "registry-list") {
      let users = db.collection("users").orderBy("__name__").limit(201),
        profiles = db
          .collection("seamlessStaffProfiles")
          .orderBy("__name__")
          .limit(201);
      if (!isHeadOfficeAdmin(actor.profile)) {
        users = users.where("station", "==", actor.profile.station);
        profiles = profiles.where("station", "==", actor.profile.station);
      }
      if (input.accountCursor)
        users = users.startAfter(cleanId(input.accountCursor));
      if (input.staffCursor)
        profiles = profiles.startAfter(cleanId(input.staffCursor));
      const [u, p] = await Promise.all([
        input.skipAccounts ? Promise.resolve({ docs: [] }) : users.get(),
        input.skipStaff ? Promise.resolve({ docs: [] }) : profiles.get(),
      ]);
      const inScope = (s) =>
        actor.profile.role !== "Lounge Manager" ||
        (s.data().seamlessStaff?.loungeIds || []).every(
          (id) => id === actor.profile.loungeId,
        );
      return {
        accounts: u.docs
          .slice(0, 200)
          .filter((s) => s.data().active === true)
          .map((s) => ({
            uid: s.id,
            name: s.data().name || s.data().username || "",
            station: s.data().station,
            role: s.data().role,
          })),
        staff: [
          ...u.docs
            .slice(0, 200)
            .filter(
              (s) => s.data().seamlessStaff?.employeeNumber && inScope(s),
            ),
          ...p.docs.slice(0, 200).filter(inScope),
        ].map(staffRecordView),
        accountCursor: u.docs.length > 200 ? u.docs[199].id : null,
        staffCursor: p.docs.length > 200 ? p.docs[199].id : null,
      };
    }
    if (a === "registry-save") {
      const name = text(input.name),
        unit = text(input.unit),
        employeeNumber = text(input.employeeNumber, 40),
        station = text(input.station, 12),
        accountUid = input.accountUid ? cleanId(input.accountUid) : "";
      if (!name || !unit || !/^[A-Za-z0-9._-]{2,40}$/.test(employeeNumber))
        fail("STAFF_FIELDS_REQUIRED");
      if (input.consent !== true || input.identityConfirmed !== true)
        fail("CONSENT_REQUIRED");
      const stations = await db
        .collection("stations")
        .where("code", "==", station)
        .get();
      if (
        !stations.docs.some(
          (s) =>
            s.data().status === "Aktif" &&
            s.data().sourceStatus !== "SOURCE_NOT_FOUND",
        )
      )
        fail("STATION_UNAVAILABLE", 409);
      const loungeIds = await validateLounges(station, input.loungeIds);
      let uid = input.uid
        ? cleanId(input.uid)
        : `stf-${hash(employeeNumber.toUpperCase()).slice(0, 32)}`;
      if (!input.uid && accountUid) {
        const existing = await db.collection("users").doc(accountUid).get();
        if (existing.exists && existing.data().seamlessStaff?.employeeNumber)
          uid = accountUid;
      }
      const ref = staffReference(db, uid),
        existing = await ref.get();
      if (existing.exists) await get(uid);
      await db.runTransaction(async (tx) => {
        const [current, number, acting, account, binding] = await Promise.all([
          tx.get(ref),
          tx.get(
            db
              .collection("seamlessEmployeeNumbers")
              .doc(hash(employeeNumber.toUpperCase())),
          ),
          tx.get(db.collection("users").doc(actor.decoded.uid)),
          accountUid ? tx.get(db.collection("users").doc(accountUid)) : null,
          accountUid
            ? tx.get(db.collection("seamlessStaffAccountLinks").doc(accountUid))
            : null,
        ]);
        assertRegistryScope({ profile: acting.data() }, station, loungeIds);
        if (
          accountUid &&
          (!account?.exists ||
            !account.data().active ||
            ![station, "ALL"].includes(account.data().station) ||
            (!isHeadOfficeAdmin(actor.profile) &&
              account.data().station !== station))
        )
          fail("STAFF_SCOPE_INVALID", 409);
        if (binding?.exists && binding.data().uid !== uid)
          fail("ACCOUNT_ALREADY_LINKED", 409);
        if (number.exists && number.data().uid !== uid)
          fail("EMPLOYEE_NUMBER_USED", 409);
        if (
          current.exists &&
          (current.data().seamlessStaff?.station || current.data().station) !==
            station &&
          !isHeadOfficeAdmin(actor.profile)
        )
          fail("STAFF_SCOPE_INVALID", 403);
        if (!uid.startsWith("stf-") && accountUid !== uid)
          fail("STAFF_SCOPE_INVALID", 409);
        const old = current.data()?.seamlessStaff || {},
          profile = {
            ...old,
            name,
            unit,
            employeeNumber,
            station,
            loungeIds,
            status: "Pending",
            active: false,
            referenceId: "",
            invitationId: "",
            consentAt: stamp(),
            identityConfirmedAt: stamp(),
            updatedAt: stamp(),
            updatedBy: actor.decoded.uid,
          };
        tx.set(
          db
            .collection("seamlessEmployeeNumbers")
            .doc(hash(employeeNumber.toUpperCase())),
          { uid, updatedAt: stamp() },
        );
        if (accountUid)
          tx.set(db.collection("seamlessStaffAccountLinks").doc(accountUid), {
            uid,
          });
        if (uid.startsWith("stf-"))
          tx.set(ref, {
            name,
            organization: unit,
            active: true,
            role: "Registered Staff",
            station,
            loungeId: "",
            accountUid,
            seamlessStaff: profile,
          });
        else tx.update(ref, { seamlessStaff: profile });
        log(tx, uid, "SEAMLESS_STAFF_REGISTER", "Pending", station);
      });
      return { uid, status: "Pending" };
    }
    if (a === "registry-info")
      return {
        name: actor.profile.seamlessStaff.name,
        station: actor.profile.seamlessStaff.station,
        expiresAt: link.expiresAt,
      };
    const uid = publicAction ? link.uid : cleanId(input.uid),
      s = await get(uid),
      p = s.data().seamlessStaff || {},
      ref = staffReference(db, uid);
    if (!p.employeeNumber) fail("REGISTER_FIRST", 409);
    if (a === "registry-browser-reference") {
      if (input.consent !== true) fail("CONSENT_REQUIRED");
      if (!["PendingReview", "Active"].includes(p.status) || !p.photos?.length) fail("PHOTO_REQUIRED", 409);
      const loungeId = cleanId(input.loungeId);
      if (!p.loungeIds?.includes(loungeId)) fail("STAFF_SCOPE_INVALID", 403);
      await validateLounges(p.station, [loungeId]);
      const accountUid = s.data().accountUid || (!uid.startsWith("stf-") ? uid : "");
      if (accountUid && (await db.collection("users").doc(accountUid).get()).data()?.active !== true)
        fail("STAFF_UNAVAILABLE", 409);
      const image = await media.read(p.photos[0].path);
      return {
        mode: "BROWSER_DEMO", displayName: p.name || s.data().name || "",
        unit: p.unit || "", station: p.station, loungeId,
        photo: `data:${image.contentType};base64,${image.bytes.toString("base64")}`,
        expiresAt: new Date(Date.now() + 600000).toISOString(),
      };
    }
    if (
      [
        "registry-upload",
        "registry-photo-upload",
        "registry-photo-repository",
      ].includes(a)
    ) {
      if (input.consent !== true) fail("CONSENT_REQUIRED");
      const owner = publicAction ? linkRef.id : actor.decoded.uid,
        pose = ["front", "left", "right"].includes(input.pose)
          ? input.pose
          : "front",
        path = `staff-enrollment/${uid}/${owner}/${a === "registry-photo-repository" ? "repo-" : ""}${randomBytes(16).toString("hex")}`;
      if (a === "registry-photo-repository") {
        const result = await media.importRepository({
          folder: text(input.folder, 200), file: text(input.file, 120),
          path, meta: { uid, owner, pose },
        });
        return { photo: { path, pose, owner }, preview: result.preview };
      }
      const image = imageBytes(input.data);
      await media.save(path, image, { uid, owner, pose });
      return { photo: { path, pose, owner } };
    }
    if (a === "registry-photo")
      return {
        url: await media.readUrl(p.photos?.[0]?.path || fail("PHOTO_REQUIRED")),
      };
    if (a === "registry-invite") {
      const token = randomBytes(32).toString("hex"),
        key = hash(token),
        expiresAt = new Date(Date.now() + 86400000).toISOString();
      await db.runTransaction(async (tx) => {
        const [current, issuer] = await Promise.all([
          tx.get(ref),
          tx.get(db.collection("users").doc(actor.decoded.uid)),
        ]);
        assertRegistryScope({ profile: issuer.data() }, p.station, p.loungeIds);
        if (JSON.stringify(current.data().seamlessStaff) !== JSON.stringify(p))
          fail("STAFF_CHANGED", 409);
        tx.create(db.collection("seamlessEnrollmentLinks").doc(key), {
          kind: "registry",
          uid,
          issuedBy: actor.decoded.uid,
          expiresAt,
        });
        tx.update(ref, {
          seamlessStaff: { ...p, invitationId: key, updatedAt: stamp() },
        });
        log(tx, uid, "SEAMLESS_ENROLLMENT_INVITE", "Issued", p.station);
      });
      return { token, expiresAt };
    }
    let next;
    if (["registry-submit", "registry-enrollment-save"].includes(a)) {
      if (input.consent !== true) fail("CONSENT_REQUIRED");
      if (
        !Array.isArray(input.photos) ||
        !input.photos.length ||
        input.photos.length > 3
      )
        fail("PHOTO_REQUIRED");
      const owner = publicAction ? linkRef.id : actor.decoded.uid,
        photos = [];
      for (const photo of input.photos) {
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
        publicAction &&
        (!["front", "right", "left"].every((pose) =>
          photos.some((p) => p.pose === pose),
        ) ||
          new Set(photos.map((p) => p.path)).size !== 3)
      )
        fail("THREE_POSES_REQUIRED");
      next = {
        ...p,
        photos,
        status: "PendingReview",
        active: false,
        referenceId: "",
        consentAt: stamp(),
        submittedAt: stamp(),
        updatedAt: stamp(),
      };
    } else if (a === "registry-deactivate")
      next = {
        ...p,
        status: "Revoked",
        active: false,
        referenceId: "",
        invitationId: "",
        updatedAt: stamp(),
      };
    else if (a === "registry-approve") {
      if (
        p.status !== "PendingReview" ||
        !p.photos?.length ||
        input.identityConfirmed !== true
      )
        fail("REVIEW_REQUIRED", 409);
      if (!provider.configured) fail("IDENTITY_NOT_CONNECTED", 503);
      await validateLounges(p.station, p.loungeIds);
      const r = await provider.enroll({
        subjectKey: uid,
        photos: p.photos,
        consentAt: p.consentAt,
        mode: "ONE_TO_ONE",
      });
      if (!r?.verified || !r.referenceId) fail("ENROLLMENT_REJECTED", 409);
      next = {
        ...p,
        status: "Active",
        active: true,
        referenceId: r.referenceId,
        approvedAt: stamp(),
        approvedBy: actor.decoded.uid,
        invitationId: "",
        updatedAt: stamp(),
      };
    } else fail("INVALID_ACTION");
    await db.runTransaction(async (tx) => {
      const [current, issuer, inv] = await Promise.all([
        tx.get(ref),
        tx.get(
          db
            .collection("users")
            .doc(publicAction ? link.issuedBy : actor.decoded.uid),
        ),
        publicAction ? tx.get(linkRef) : null,
      ]);
      assertRegistryScope({ profile: issuer.data() }, p.station, p.loungeIds);
      if (
        !current.exists ||
        JSON.stringify(current.data().seamlessStaff) !== JSON.stringify(p)
      )
        fail("STAFF_CHANGED", 409);
      if (next.status !== "Revoked" && !current.data().active)
        fail("STAFF_UNAVAILABLE", 409);
      if (
        publicAction &&
        (!inv.exists ||
          inv.data().usedAt ||
          inv.data().expiresAt <= stamp() ||
          current.data().seamlessStaff.invitationId !== linkRef.id)
      )
        fail("LINK_INVALID", 403);
      if (next.status === "Active")
        await validateLounges(p.station, p.loungeIds, tx);
      tx.update(ref, { seamlessStaff: next });
      if (publicAction) tx.update(linkRef, { usedAt: stamp() });
      log(
        tx,
        uid,
        "SEAMLESS_" + a.replaceAll("-", "_").toUpperCase(),
        next.status,
        p.station,
      );
    });
    return { status: next.status };
  };
}
