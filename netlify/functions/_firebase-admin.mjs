import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const privateKey = (name) => (process.env[name] || "").replace(/\\n/g, "\n");

function appFor(name, prefix) {
  const existing = getApps().find((app) => app.name === name);
  if (existing) return existing;
  return initializeApp({
    credential: cert({
      projectId: process.env[`${prefix}_PROJECT_ID`],
      clientEmail: process.env[`${prefix}_CLIENT_EMAIL`],
      privateKey: privateKey(`${prefix}_PRIVATE_KEY`),
    }),
  }, name);
}

export const targetApp = () => appFor("gaes-target", "FIREBASE");
export const sourceApp = () => appFor("gaes-source", "SOURCE_FIREBASE");
export const targetAuth = () => getAuth(targetApp());
export const targetDb = () => getFirestore(targetApp());
export const sourceDb = () => getFirestore(sourceApp());

export async function requireUser(event, roles = []) {
  const token = event.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!token) throw Object.assign(new Error("Authentication required."), { status: 401 });
  const decoded = await targetAuth().verifyIdToken(token);
  const profile = await targetDb().collection("users").doc(decoded.uid).get();
  const data = profile.data() || {};
  if (!data.active || (roles.length && !roles.includes(data.role))) {
    throw Object.assign(new Error("User does not have permission."), { status: 403 });
  }
  return { decoded, profile: data };
}

export const json = (statusCode, value) => ({
  statusCode,
  headers: { "content-type": "application/json; charset=utf-8" },
  body: JSON.stringify(value),
});

export const failure = (error) => json(error.status || 500, { error: error.message || "Server error." });
