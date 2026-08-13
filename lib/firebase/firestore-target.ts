import type { FirebaseApp } from "firebase/app";
import { getFirestore, type Firestore } from "firebase/firestore";

/** See the server counterpart in functions/src/firestore-target.ts. */
export const HEMAS_FIRESTORE_DATABASE_ID = "(default)" as const;

export function getHemasFirestore(app: FirebaseApp): Firestore {
  return getFirestore(app, HEMAS_FIRESTORE_DATABASE_ID);
}
