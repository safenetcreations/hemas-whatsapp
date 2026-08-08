import { getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";
import {
  connectFirestoreEmulator,
  getFirestore,
  type Firestore,
} from "firebase/firestore";
import {
  connectStorageEmulator,
  getStorage,
  type FirebaseStorage,
} from "firebase/storage";
import { evaluateLocalAuthPolicy, syntheticAuthProjectId } from "./auth-policy";

const localServicesAppName = "hemas-connect-local-services";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "demo-api-key",
  authDomain:
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ??
    `${syntheticAuthProjectId}.firebaseapp.com`,
  projectId:
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? syntheticAuthProjectId,
  storageBucket:
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ??
    "demo-hemas-connect.firebasestorage.app",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "demo-app-id",
};

type FirebaseServices = {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
  storage: FirebaseStorage;
};

declare global {
  var __hemasFirebaseServices: FirebaseServices | undefined;
  var __hemasFirebaseEmulatorsConnected: boolean | undefined;
}

export function getFirebaseServices(): FirebaseServices {
  if (globalThis.__hemasFirebaseServices) {
    return globalThis.__hemasFirebaseServices;
  }

  if (typeof window === "undefined") {
    throw new Error("Local Firebase services can only initialize in a browser.");
  }
  const policy = evaluateLocalAuthPolicy({
    hostname: window.location.hostname,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    appStage: process.env.NEXT_PUBLIC_APP_STAGE,
    useFirebaseEmulators: process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS,
    externalMessagingEnabled: process.env.NEXT_PUBLIC_EXTERNAL_MESSAGING_ENABLED,
    realPatientDataEnabled: process.env.NEXT_PUBLIC_REAL_PATIENT_DATA_ENABLED,
  });
  if (!policy.allowed) {
    throw new Error(`Local Firebase services refused unsafe configuration: ${policy.reason}.`);
  }

  const app =
    getApps().find((candidate) => candidate.name === localServicesAppName) ??
    initializeApp(firebaseConfig, localServicesAppName);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const storage = getStorage(app);

  if (
    !globalThis.__hemasFirebaseEmulatorsConnected
  ) {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", {
      disableWarnings: true,
    });
    connectFirestoreEmulator(db, "127.0.0.1", 8080);
    connectStorageEmulator(storage, "127.0.0.1", 9199);
    globalThis.__hemasFirebaseEmulatorsConnected = true;
  }

  const services = { app, auth, db, storage };
  globalThis.__hemasFirebaseServices = services;
  return services;
}
