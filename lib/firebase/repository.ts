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
  where,
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
  | "monitoringRows"
  | "loungeCapacityHistory"
  | "loungePriceHistory";

function clean<T extends Record<string, unknown>>(value: T): T {
  const sanitized = Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  );
  return JSON.parse(JSON.stringify(sanitized)) as T;
}

export function subscribeCollection<T>(
  name: GaesCollection,
  callback: (rows: T[]) => void,
  sortField?: string,
  onError?: (error: Error) => void,
) {
  if (!db) return () => undefined;
  const base = collection(db, name);
  const source = sortField ? query(base, orderBy(sortField)) : base;
  return onSnapshot(
    source,
    (snapshot) => {
      try {
        callback(
          snapshot.docs.map((item: QueryDocumentSnapshot<DocumentData>) => ({
            id: item.id,
            ...item.data(),
          })) as T[],
        );
      } catch (error) {
        onError?.(
          error instanceof Error
            ? error
            : new Error("Data tidak dapat diproses."),
        );
      }
    },
    (error) => onError?.(error),
  );
}

export function subscribeUserNotifications<T>(
  userId: string,
  callback: (rows: T[]) => void,
  onError?: (error: Error) => void,
) {
  if (!db || !userId) return () => undefined;
  return onSnapshot(
    query(collection(db, "notifications"), where("userId", "==", userId)),
    (snapshot) =>
      callback(
        snapshot.docs.map((item: QueryDocumentSnapshot<DocumentData>) => ({
          id: item.id,
          ...item.data(),
        })) as T[],
      ),
    (error) => onError?.(error),
  );
}

export function subscribeLoungeCapacityHistory<T>(
  loungeId: string | null,
  callback: (rows: T[]) => void,
  onError?: (error: Error) => void,
) {
  if (!db || !loungeId) return () => undefined;
  return onSnapshot(
    query(collection(db, "loungeCapacityHistory"), where("loungeId", "==", loungeId)),
    (snapshot) =>
      callback(
        snapshot.docs.map((item: QueryDocumentSnapshot<DocumentData>) => ({
          id: item.id,
          ...item.data(),
        })) as T[],
      ),
    (error) => onError?.(error),
  );
}

export function subscribeLoungePriceHistory<T>(
  loungeId: string | null,
  callback: (rows: T[]) => void,
  onError?: (error: Error) => void,
) {
  if (!db || !loungeId) return () => undefined;
  return onSnapshot(
    query(collection(db, "loungePriceHistory"), where("loungeId", "==", loungeId)),
    (snapshot) => callback(snapshot.docs.map((item: QueryDocumentSnapshot<DocumentData>) => ({ id: item.id, ...item.data() })) as T[]),
    (error) => onError?.(error),
  );
}

export function subscribeVisitors<T>(
  station: string,
  callback: (rows: T[]) => void,
  onError?: (error: Error) => void,
) {
  if (!db) return () => undefined;
  const base = collection(db, "visitors");
  const source =
    station && station !== "ALL"
      ? query(base, where("airport", "==", station))
      : base;
  return onSnapshot(
    source,
    (snapshot) =>
      callback(
        snapshot.docs.map((item: QueryDocumentSnapshot<DocumentData>) => ({
          id: item.id,
          ...item.data(),
        })) as T[],
      ),
    (error) => onError?.(error),
  );
}

export async function saveRecord<T extends { id: string }>(
  name: GaesCollection,
  value: T,
) {
  if (!db) throw new Error("Firebase belum dikonfigurasi.");
  if (!String(value.id || "").trim())
    throw new Error("ID data wajib tersedia.");
  await setDoc(
    doc(db, name, value.id),
    {
      ...clean(value),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export async function removeRecord(name: GaesCollection, id: string) {
  if (!db) throw new Error("Firebase belum dikonfigurasi.");
  await deleteDoc(doc(db, name, id));
}
