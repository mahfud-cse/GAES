import { failure, json, targetDb } from "./_firebase-admin.mjs";

export default async (request) => {
  try {
    if (request.method !== "POST")
      return json(405, { error: "Method not allowed." });
    const input = await request.json();
    const identity = String(input.identity || "")
      .trim()
      .toLowerCase();
    const message = String(input.message || "")
      .trim()
      .slice(0, 500);
    if (!identity)
      return json(400, { error: "Email atau username wajib diisi." });

    const db = targetDb();
    let targetUid = "";
    let targetName = identity;
    if (identity.includes("@")) {
      const match = await db
        .collection("users")
        .where("email", "==", identity)
        .limit(1)
        .get();
      if (!match.empty) {
        targetUid = match.docs[0].id;
        targetName = match.docs[0].data().name || identity;
      }
    } else {
      const username = await db.collection("usernames").doc(identity).get();
      if (username.exists) {
        targetUid = String(username.data()?.uid || "");
        if (targetUid) {
          const profile = await db.collection("users").doc(targetUid).get();
          targetName = profile.data()?.name || identity;
        }
      }
    }

    // Return the same response for known and unknown identities to avoid
    // exposing which accounts are registered on the portal.
    if (!targetUid) return json(202, { submitted: true });

    const requestRef = db.collection("passwordResetRequests").doc();
    const admins = await db
      .collection("users")
      .where("role", "in", ["Super Admin", "Admin"])
      .get();
    const batch = db.batch();
    batch.set(requestRef, {
      id: requestRef.id,
      targetUid,
      identity,
      targetName,
      message,
      status: "Open",
      createdAt: new Date(),
    });
    admins.docs
      .filter((item) => item.data().active === true)
      .forEach((item) => {
        const notification = db.collection("notifications").doc();
        batch.set(notification, {
          id: notification.id,
          userId: item.id,
          type: "PASSWORD_RESET_REQUEST",
          title: "Permintaan reset password",
          text: `${targetName} (${identity}) meminta reset password.${message ? ` ${message}` : ""}`,
          targetUid,
          requestId: requestRef.id,
          active: true,
          createdAt: new Date(),
        });
      });
    await batch.commit();
    return json(202, { submitted: true });
  } catch (error) {
    return failure(error);
  }
};
