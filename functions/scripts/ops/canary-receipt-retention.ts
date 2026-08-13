import { applicationDefault, deleteApp, initializeApp } from "firebase-admin/app";
import { FieldPath, getFirestore, type DocumentReference } from "firebase-admin/firestore";
import {
  HEMAS_CANARY_RECEIPT_COLLECTION,
  HEMAS_MIN_RECEIPT_RETENTION_DAYS,
  HEMAS_OPERATOR_WORKSPACE_ID,
  HEMAS_PRIMARY_DATABASE_ID,
  HEMAS_RECEIPTS_APPLY_CONFIRMATION,
  aggregateCanaryReceipts,
  assertSafeOperatorEnvironment,
  classifyCanaryReceipt,
  parseReceiptCommand,
} from "./contracts.js";

const HELP = `Hemas historical canary-receipt retention operator (dry-run by default)

Usage:
  npm --prefix functions run ops:receipts -- \\
    --project hemas-whatsapp --database '(default)' \\
    --cutoff '2026-07-01T00:00:00.000Z'

The tool reads only receipt schema, timestamp, and legacy raw-sender presence. It prints aggregate
counts only. It never prints document IDs, sender values, message IDs, UIDs, or email addresses.
To delete exact schema-v1 receipts older than the cutoff, add:
  --apply --confirm ${HEMAS_RECEIPTS_APPLY_CONFIRMATION}

Use --max-docs N to change the bounded scan (default 5000, maximum 20000). Apply mode refuses
to delete anything if the bounded scan is truncated. The cutoff must retain at least
${HEMAS_MIN_RECEIPT_RETENTION_DAYS} full days of deduplication receipts.
`;

async function deleteInBatches(
  database: ReturnType<typeof getFirestore>,
  references: readonly DocumentReference[],
): Promise<void> {
  for (let offset = 0; offset < references.length; offset += 400) {
    const batch = database.batch();
    for (const reference of references.slice(offset, offset + 400)) {
      batch.delete(reference);
    }
    await batch.commit();
  }
}

async function run(): Promise<void> {
  if (process.argv.slice(2).includes("--help")) {
    console.log(HELP);
    return;
  }

  const command = parseReceiptCommand(process.argv.slice(2));
  assertSafeOperatorEnvironment(process.env, command.target);
  const app = initializeApp(
    {
      credential: applicationDefault(),
      projectId: command.target.projectId,
    },
    "hemas-canary-receipt-operator",
  );

  try {
    const database = getFirestore(app, HEMAS_PRIMARY_DATABASE_ID);
    const snapshot = await database
      .collection("workspaces")
      .doc(HEMAS_OPERATOR_WORKSPACE_ID)
      .collection(HEMAS_CANARY_RECEIPT_COLLECTION)
      .select("schemaVersion", "receivedAt", "fromNumber")
      .orderBy(FieldPath.documentId())
      .limit(command.maxDocuments + 1)
      .get();

    const truncated = snapshot.size > command.maxDocuments;
    const documents = snapshot.docs.slice(0, command.maxDocuments);
    const nowMs = Date.now();
    const aggregate = aggregateCanaryReceipts(
      documents.map((document) => document.data()),
      nowMs,
      command.cutoffMs,
    );
    const deletionReferences = documents
      .filter((document) =>
        classifyCanaryReceipt(document.data(), nowMs, command.cutoffMs).eligibleForDeletion,
      )
      .map((document) => document.ref);

    console.log(JSON.stringify({
      mode: command.mode,
      project: command.target.projectId,
      database: command.target.databaseLabel,
      cutoff: command.cutoffIso,
      maxDocuments: command.maxDocuments,
      truncated,
      aggregate,
    }, null, 2));

    if (command.mode === "dry-run") {
      console.log("Dry run complete. No receipts were deleted.");
      return;
    }
    if (truncated) {
      throw new Error("Refusing an incomplete retention apply.");
    }

    await deleteInBatches(database, deletionReferences);
    console.log(`Apply complete. Deleted ${deletionReferences.length} eligible legacy receipts.`);
  } finally {
    await deleteApp(app);
  }
}

run().catch(() => {
  console.error(
    "Operator command failed. Details are suppressed to avoid exposing receipt or credential identifiers. If apply mode was used, rerun the dry-run plan before retrying.",
  );
  process.exitCode = 1;
});
