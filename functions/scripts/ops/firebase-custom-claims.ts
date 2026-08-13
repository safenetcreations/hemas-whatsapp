import { applicationDefault, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import {
  HEMAS_CLAIMS_APPLY_CONFIRMATION,
  HEMAS_OPERATOR_CLAIMS,
  HEMAS_OPERATOR_WORKSPACE_ID,
  assertSafeOperatorEnvironment,
  assertClaimTargetEligibility,
  buildClaimsMergePlan,
  buildClaimsPublicSummary,
  parseClaimsCommand,
} from "./contracts.js";

const HELP = `Hemas Firebase custom-claim operator (dry-run by default)

Usage:
  npm --prefix functions run ops:claims -- \\
    --project hemas-whatsapp --database '(default)' \\
    --email '<private-email>' \\
    --action grant --claims hemasPortalDemo,hemasLiteCanary,hemasLiteAdmin

Use exactly one of --email or --uid. Allowed claims: ${HEMAS_OPERATOR_CLAIMS.join(", ")}.
To mutate, add: --apply --confirm ${HEMAS_CLAIMS_APPLY_CONFIRMATION}
To close access after a demo, revoke with both: --disable-membership --revoke-tokens

Output intentionally never includes an email address, UID, secret, or current unrelated claims.
`;

async function run(): Promise<void> {
  if (process.argv.slice(2).includes("--help")) {
    console.log(HELP);
    return;
  }

  const command = parseClaimsCommand(process.argv.slice(2));
  assertSafeOperatorEnvironment(process.env, command.target);
  const app = initializeApp(
    {
      credential: applicationDefault(),
      projectId: command.target.projectId,
    },
    "hemas-custom-claims-operator",
  );

  try {
    const auth = getAuth(app);
    const user = command.identity.kind === "email"
      ? await auth.getUserByEmail(command.identity.value)
      : await auth.getUser(command.identity.value);
    assertClaimTargetEligibility(
      { uid: user.uid, emailVerified: user.emailVerified },
      command.action,
    );
    const plan = buildClaimsMergePlan(user.customClaims, command.action, command.claims);

    console.log(JSON.stringify(buildClaimsPublicSummary(command, plan), null, 2));

    if (command.mode === "dry-run") {
      console.log("Dry run complete. No claims or tokens were changed.");
      return;
    }

    if (command.disableMembership) {
      const membershipRef = getFirestore(app, command.target.databaseId)
        .collection("workspaces")
        .doc(HEMAS_OPERATOR_WORKSPACE_ID)
        .collection("members")
        .doc(user.uid);
      const membership = await membershipRef.get();
      const membershipData = membership.data();
      if (
        membership.exists &&
        membershipData?.id === user.uid &&
        membershipData.uid === user.uid &&
        membershipData.workspaceId === HEMAS_OPERATOR_WORKSPACE_ID
      ) {
        await membershipRef.set(
          {
            status: "disabled",
            accessDisabledAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }
    }

    if (plan.changedClaims.length > 0) {
      await auth.setCustomUserClaims(user.uid, plan.nextClaims);
      const verifiedUser = await auth.getUser(user.uid);
      const remainingChanges = buildClaimsMergePlan(
        verifiedUser.customClaims,
        command.action,
        command.claims,
      );
      if (remainingChanges.changedClaims.length > 0) {
        throw new Error("Custom-claim verification failed.");
      }
    }
    if (command.revokeTokens) {
      await auth.revokeRefreshTokens(user.uid);
    }
    console.log("Apply complete for one privately selected Auth user.");
  } finally {
    await deleteApp(app);
  }
}

run().catch(() => {
  console.error(
    "Operator command failed. Details are suppressed to avoid exposing an email, UID, or credential context. If apply mode was used, rerun the dry-run plan before retrying.",
  );
  process.exitCode = 1;
});
