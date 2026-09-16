import {
  type DocumentData,
  type QueryDocumentSnapshot,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { db } from "./client";

export type GaesCollection =
  | "visitors"
  | "lounges"
  | "flights"
  | "users"
  | "roles"
  | "stations"
  | "entitlements"
  | "airlines"
  | "notifications"
  | "auditLogs"
  | "portalConfiguration"
  | "monitoringRows";

function clean<T extends Record<string, unknown>>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function subscribeCollection<T>(
  name: GaesCollection,
  callback: (rows: T[]) => void,
  sortField?: string,
) {
  if (!db) return () => undefined;
  const base = collection(db, name);
  const source = sortField ? query(base, orderBy(sortField)) : base;
  return onSnapshot(source, (snapshot) => {
    callback(snapshot.docs.map((item: QueryDocumentSnapshot<DocumentData>) => ({
      id: item.id,
      ...item.data(),
    })) as T[]);
  });
}

export async function saveRecord<T extends { id: string }>(name: GaesCollection, value: T) {
  if (!db) throw new Error("Firebase belum dikonfigurasi.");
  await setDoc(doc(db, name, value.id), {
    ...clean(value),
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

export async function removeRecord(name: GaesCollection, id: string) {
  if (!db) throw new Error("Firebase belum dikonfigurasi.");
  await deleteDoc(doc(db, name, id));
}
