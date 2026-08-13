import type { App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

/**
 * The Hemas UAT project also contains a distinct Enterprise database named
 * `default`. Every application data path is intentionally bound to Firebase's
 * Standard `(default)` database so operator tooling and runtimes cannot drift
 * between the two similarly named instances.
 */
export const HEMAS_FIRESTORE_DATABASE_ID = "(default)" as const;

export function getHemasFirestore(app: App): Firestore {
  return getFirestore(app, HEMAS_FIRESTORE_DATABASE_ID);
}
