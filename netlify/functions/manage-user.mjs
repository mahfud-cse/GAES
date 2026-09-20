import {
  failure,
  json,
  requireUser,
  targetAuth,
  targetDb,
} from "./_firebase-admin.mjs";

const allowedRoles = new Set([
  "Super Admin",
  "Admin",
  "HO Admin",
  "BO Admin",
  "Lounge Officer",
  "Lounge Manager",
  "HO Ancillary Coordinator",
  "HO Ancillary Verifier",
  "Airline Coordinator",
  "Airline Verifier",
  "Report Viewer",
]);

export default async (request) => {
  try {
    if (request.method !== "POST")
      return json(405, { error: "Method not allowed." });
    const actor = await requireUser(request, ["Super Admin", "Admin"]);
    const input = await request.json();
    const uid = String(input.uid || "");
    if (!uid || uid === actor.decoded.uid)
      return json(400, { error: "Target akun tidak valid." });

    const db = targetDb();
    const current = await db.collection("users").doc(uid).get();
    if (!current.exists) return json(404, { error: "Akun tidak ditemukan." });
    const before = current.data();
    if (
      actor.profile.role !== "Super Admin" &&
      (before.role === "Super Admin" || input.role === "Super Admin")
    ) {
      return json(403, { error: "Admin tidak dapat mengelola Super Admin." });
    }

    const action = String(input.action || "update");
    const auth = targetAuth();
    if (action === "resetPassword") {
      const password = String(input.password || "");
      if (password.length < 8)
        return json(400, { error: "Password baru minimal 8 karakter." });
      await auth.updateUser(uid, { password });
      await db.collection("users").doc(uid).set(
        {
          mustChangePassword: true,
          passwordResetAt: new Date(),
          updatedAt: new Date(),
          updatedBy: actor.decoded.uid,
        },
        { merge: true },
      );
      await db.collection("auditLogs").add({
        action: "RESET_USER_PASSWORD",
        targetId: uid,
        actorId: actor.decoded.uid,
        createdAt: new Date(),
      });
      return json(200, { uid });
    }
    if (action === "delete") {
      const batch = db.batch();
      if (before.username)
        batch.delete(db.collection("usernames").doc(before.username));
      batch.delete(db.collection("users").doc(uid));
      batch.set(db.collection("auditLogs").doc(), {
        action: "DELETE_USER",
        targetId: uid,
        actorId: actor.decoded.uid,
        before,
        createdAt: new Date(),
      });
      await auth.updateUser(uid, { disabled: true });
      let firestoreDeleted = false;
      try {
        await batch.commit();
        firestoreDeleted = true;
        await auth.deleteUser(uid);
      } catch (error) {
        if (firestoreDeleted) {
          const restore = db.batch();
          restore.set(db.collection("users").doc(uid), before);
          if (before.username)
            restore.set(db.collection("usernames").doc(before.username), {
              uid,
              email: before.email,
              active: before.active !== false,
            });
          await restore.commit().catch(() => undefined);
        }
        await auth.updateUser(uid, { disabled: false }).catch(() => undefined);
        throw error;
      }
      return json(200, { uid });
    }

    const username = String(input.username || before.username)
      .trim()
      .toLowerCase();
    const email = String(input.email || before.email)
      .trim()
      .toLowerCase();
    const nextRole = String(input.role || before.role);
    if (
      !/^[a-z0-9._-]{3,40}$/.test(username) ||
      !email.includes("@") ||
      !allowedRoles.has(nextRole)
    ) {
      return json(400, { error: "Email, username, atau role tidak valid." });
    }
    if (username !== before.username) {
      const owner = await db.collection("usernames").doc(username).get();
      if (owner.exists && owner.data()?.uid !== uid)
        return json(409, { error: "Username sudah digunakan." });
    }
    const active = input.status !== "Nonaktif";
    await auth.updateUser(uid, {
      email,
      displayName: input.name || before.name,
      disabled: !active,
    });

    const batch = db.batch();
    if (username !== before.username)
      batch.delete(db.collection("usernames").doc(before.username));
    batch.set(db.collection("usernames").doc(username), { uid, email, active });
    batch.set(
      db.collection("users").doc(uid),
      {
        name: input.name,
        username,
        email,
        role: nextRole,
        station: input.station,
        scope: input.scope,
        organization: input.organization,
        verificationScopes: input.verificationScopes || [],
        active,
        updatedAt: new Date(),
        updatedBy: actor.decoded.uid,
      },
      { merge: true },
    );
    batch.set(db.collection("auditLogs").doc(), {
      action: active ? "UPDATE_USER" : "DEACTIVATE_USER",
      targetId: uid,
      actorId: actor.decoded.uid,
      before,
      createdAt: new Date(),
    });
    try {
      await batch.commit();
    } catch (error) {
      // Restore the Auth record if the Firestore profile/audit update fails.
      // This prevents an account from ending up with two conflicting states.
      await auth
        .updateUser(uid, {
          email: before.email,
          displayName: before.name,
          disabled: before.active === false,
        })
        .catch(() => undefined);
      throw error;
    }
    return json(200, { uid });
  } catch (error) {
    return failure(error);
  }
};
