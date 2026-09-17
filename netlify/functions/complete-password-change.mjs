import { failure, json, requireUser, targetDb } from "./_firebase-admin.mjs";

export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed." });
    const actor = await requireUser(event);
    await targetDb().collection("users").doc(actor.decoded.uid).set({
      mustChangePassword: false,
      passwordChangedAt: new Date(),
      updatedAt: new Date(),
    }, { merge: true });
    return json(200, { uid: actor.decoded.uid });
  } catch (error) { return failure(error); }
}
