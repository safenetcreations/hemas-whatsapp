"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  AutomationRunAction,
  CareEnrollmentAction,
  CareSuppressionReason,
} from "@/lib/domain/automations";
import {
  controlSyntheticAutomationThroughLocalFunctions,
  controlSyntheticCareThroughLocalFunctions,
  Phase5FunctionsClientError,
} from "@/lib/firebase/automation-care-functions-emulator";
import { getLocalEmulatorFirestore } from "@/lib/firebase/auth-emulator";
import type { VerifiedWorkspaceSession } from "@/lib/firebase/workspace-session-model";
import {
  assertAutomationActionEvidence,
  assertCareActionEvidence,
  AutomationWorkspaceDataError,
  buildAutomationActionRequest,
  buildCareActionRequest,
  describeAutomationWorkspaceError,
  loadAutomationWorkspace,
  readAutomationActionEvidence,
  readCareActionEvidence,
  type AutomationOperationRecord,
  type AutomationWorkspaceResult,
  type CareOperationRecord,
} from "./automation-workspace-data";

export type AutomationWorkspaceLoadState =
  | { readonly status: "loading"; readonly result: null; readonly message: null }
  | {
      readonly status: "ready";
      readonly result: AutomationWorkspaceResult;
      readonly message: null;
    }
  | {
      readonly status: "denied" | "evidence_mismatch" | "error";
      readonly result: null;
      readonly message: string;
    };

export type AutomationWorkspaceActionState =
  | {
      readonly status: "idle";
      readonly family: null;
      readonly action: null;
      readonly message: null;
    }
  | {
      readonly status:
        | "working"
        | "success"
        | "replay"
        | "conflict"
        | "evidence_mismatch"
        | "error";
      readonly family: "automation" | "care";
      readonly action: AutomationRunAction | CareEnrollmentAction;
      readonly message: string;
    };

const initialLoadState: AutomationWorkspaceLoadState = {
  status: "loading",
  result: null,
  message: null,
};
const initialActionState: AutomationWorkspaceActionState = {
  status: "idle",
  family: null,
  action: null,
  message: null,
};

export function automationControlsLocked(
  state: AutomationWorkspaceActionState,
): boolean {
  return (
    state.status === "working" ||
    state.status === "conflict" ||
    state.status === "evidence_mismatch" ||
    state.status === "error"
  );
}

function actionLabel(action: AutomationRunAction | CareEnrollmentAction): string {
  return action.replaceAll("_", " ");
}

function actionFailureMessage(
  error: unknown,
  family: "automation" | "care",
  action: AutomationRunAction | CareEnrollmentAction,
): string {
  const label = actionLabel(action);
  const code =
    error instanceof Phase5FunctionsClientError ||
    error instanceof AutomationWorkspaceDataError
      ? error.code
      : typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : "";
  if (code === "identity_mismatch" || code === "authentication_required") {
    return `The verified local Firebase Auth identity could not authorize ${label}. Sign in to the seeded emulator account again.`;
  }
  if (code === "permission_denied" || code === "access_denied") {
    return `This verified role or exact team-and-location scope cannot request ${label}.`;
  }
  if (code === "service_denied") {
    return `The governed ${family} service refused ${label} in the current persisted state.`;
  }
  if (code === "emulator_unavailable") {
    return `The localhost Functions emulator could not process ${label}. No cloud fallback was attempted.`;
  }
  if (code === "invalid_request" || code === "invalid_response") {
    return `The ${label} callable failed its strict request or response contract. No result was assumed.`;
  }
  if (code === "evidence_mismatch") {
    return `The ${label} result failed its exact aggregate, event, audit, pointer, or result-fingerprint reconciliation. Fresher authoritative state was retained, but success was not shown.`;
  }
  if (code === "unsafe_endpoint") {
    return `${label} was blocked because the callable was not the approved 127.0.0.1 emulator endpoint.`;
  }
  return `${label} did not complete through the governed localhost transaction. No Meta, Hemas, provider, or external action was attempted.`;
}

export function useAutomationWorkspace(session: VerifiedWorkspaceSession) {
  const [loadState, setLoadState] =
    useState<AutomationWorkspaceLoadState>(initialLoadState);
  const [actionState, setActionState] =
    useState<AutomationWorkspaceActionState>(initialActionState);
  const sequence = useRef(0);
  const actionInFlight = useRef(false);
  const teamIdsKey = session.teamIds.join("\u001f");
  const locationIdsKey = session.locationIds.join("\u001f");
  const authority = useMemo<VerifiedWorkspaceSession>(
    () => ({
      workspaceId: session.workspaceId,
      workspaceName: session.workspaceName,
      workspaceMode: session.workspaceMode,
      dataClassification: session.dataClassification,
      uid: session.uid,
      displayLabel: session.displayLabel,
      role: session.role,
      scopeMode: session.scopeMode,
      teamIds: teamIdsKey ? teamIdsKey.split("\u001f") : [],
      locationIds: locationIdsKey ? locationIdsKey.split("\u001f") : [],
    }),
    [
      locationIdsKey,
      session.dataClassification,
      session.displayLabel,
      session.role,
      session.scopeMode,
      session.uid,
      session.workspaceId,
      session.workspaceMode,
      session.workspaceName,
      teamIdsKey,
    ],
  );

  const load = useCallback(
    async (showLoading = true): Promise<AutomationWorkspaceResult | null> => {
      const requestSequence = ++sequence.current;
      if (showLoading) setLoadState(initialLoadState);
      try {
        const result = await loadAutomationWorkspace(
          getLocalEmulatorFirestore(),
          authority,
        );
        if (requestSequence !== sequence.current) return null;
        setLoadState({ status: "ready", result, message: null });
        return result;
      } catch (error) {
        if (requestSequence !== sequence.current) return null;
        setLoadState({
          status:
            error instanceof AutomationWorkspaceDataError
              ? error.code === "access_denied"
                ? "denied"
                : error.code === "evidence_mismatch"
                  ? "evidence_mismatch"
                  : "error"
              : "error",
          result: null,
          message: describeAutomationWorkspaceError(error),
        });
        return null;
      }
    },
    [authority],
  );

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setActionState(initialActionState);
      void load();
    });
    return () => {
      active = false;
      sequence.current += 1;
    };
  }, [load]);

  const retry = useCallback(() => {
    setActionState(initialActionState);
    void load();
  }, [load]);

  const requestAutomationAction = useCallback(
    async (
      previous: AutomationOperationRecord,
      action: AutomationRunAction,
    ): Promise<void> => {
      if (actionInFlight.current) return;
      actionInFlight.current = true;
      const actionSequence = ++sequence.current;
      const label = actionLabel(action);
      setActionState({
        status: "working",
        family: "automation",
        action,
        message: `Calling one revision-bound ${label} transaction on 127.0.0.1…`,
      });
      try {
        const request = await buildAutomationActionRequest({
          session: authority,
          operation: previous,
          action,
        });
        const response = await controlSyntheticAutomationThroughLocalFunctions({
          actorUid: authority.uid,
          request,
        });
        const db = getLocalEmulatorFirestore();
        const [fresh, evidence] = await Promise.all([
          loadAutomationWorkspace(db, authority),
          readAutomationActionEvidence(db, authority.workspaceId, response),
        ]);
        if (actionSequence !== sequence.current) return;
        if (fresh.automationOperation.status !== "available") {
          throw new AutomationWorkspaceDataError(
            "The automation run is no longer readable under this authority.",
            "evidence_mismatch",
          );
        }
        // Install the no-cache authoritative reload before evaluating returned
        // evidence. A substituted or stale response must never leave old action
        // affordances on screen.
        setLoadState({ status: "ready", result: fresh, message: null });
        await assertAutomationActionEvidence({
          session: authority,
          previous,
          current: fresh.automationOperation.record,
          request,
          response,
          evidence,
        });
        setActionState({
          status: response.replayed ? "replay" : "success",
          family: "automation",
          action,
          message: response.replayed
            ? `The identical ${label} request replayed safely. Aggregate, event, audit, pointer, revision, and result fingerprint match; externalDispatchCount=0 and networkCallCount=0.`
            : `${label} persisted atomically. Aggregate, event, audit, pointer, revision, and result fingerprint match; externalDispatchCount=0 and networkCallCount=0.`,
        });
      } catch (error) {
        const conflict =
          error instanceof Phase5FunctionsClientError &&
          (error.code === "revision_conflict" ||
            error.code === "idempotency_conflict");
        if (conflict) {
          const fresh = await load(false);
          setActionState({
            status: fresh ? "conflict" : "error",
            family: "automation",
            action,
            message: fresh
              ? "The deterministic request conflicted with newer durable evidence. Authoritative Firestore state was reloaded; review it before trying again."
              : "A callable conflict occurred and authoritative state could not be reloaded. Use Retry.",
          });
        } else {
          const authoritativeReload = await load(false);
          setActionState({
            status:
              error instanceof AutomationWorkspaceDataError &&
              error.code === "evidence_mismatch"
                ? "evidence_mismatch"
                : "error",
            family: "automation",
            action,
            message: `${actionFailureMessage(error, "automation", action)} ${
              authoritativeReload
                ? "Authoritative Firestore state was reloaded, but this transition remains unconfirmed. Controls stay locked until Retry completes a clean read."
                : "Authoritative Firestore state could not be reloaded. Controls stay locked; use Retry."
            }`,
          });
        }
      } finally {
        actionInFlight.current = false;
      }
    },
    [authority, load],
  );

  const requestCareAction = useCallback(
    async (
      previous: CareOperationRecord,
      action: CareEnrollmentAction,
      suppressionReason: CareSuppressionReason | null,
    ): Promise<void> => {
      if (actionInFlight.current) return;
      actionInFlight.current = true;
      const actionSequence = ++sequence.current;
      const label = actionLabel(action);
      setActionState({
        status: "working",
        family: "care",
        action,
        message: `Calling one revision-bound ${label} transaction on 127.0.0.1…`,
      });
      try {
        const request = await buildCareActionRequest({
          session: authority,
          operation: previous,
          action,
          suppressionReason,
        });
        const response = await controlSyntheticCareThroughLocalFunctions({
          actorUid: authority.uid,
          request,
        });
        const db = getLocalEmulatorFirestore();
        const [fresh, evidence] = await Promise.all([
          loadAutomationWorkspace(db, authority),
          readCareActionEvidence(db, authority.workspaceId, response),
        ]);
        if (actionSequence !== sequence.current) return;
        if (fresh.careOperation.status !== "available") {
          throw new AutomationWorkspaceDataError(
            "The care enrollment is no longer readable under this authority.",
            "evidence_mismatch",
          );
        }
        setLoadState({ status: "ready", result: fresh, message: null });
        await assertCareActionEvidence({
          session: authority,
          previous,
          current: fresh.careOperation.record,
          request,
          response,
          evidence,
        });
        setActionState({
          status: response.replayed ? "replay" : "success",
          family: "care",
          action,
          message: response.replayed
            ? `The identical ${label} request replayed safely. Enrollment, event, audit, lifecycle pointers, revision, and result fingerprint match; both safety counters remain zero.`
            : `${label} persisted atomically. Enrollment, event, audit, lifecycle pointers, revision, and result fingerprint match; both safety counters remain zero.`,
        });
      } catch (error) {
        const conflict =
          error instanceof Phase5FunctionsClientError &&
          (error.code === "revision_conflict" ||
            error.code === "idempotency_conflict");
        if (conflict) {
          const fresh = await load(false);
          setActionState({
            status: fresh ? "conflict" : "error",
            family: "care",
            action,
            message: fresh
              ? "The deterministic request conflicted with newer durable evidence. Authoritative Firestore state was reloaded; review it before trying again."
              : "A callable conflict occurred and authoritative state could not be reloaded. Use Retry.",
          });
        } else {
          const authoritativeReload = await load(false);
          setActionState({
            status:
              error instanceof AutomationWorkspaceDataError &&
              error.code === "evidence_mismatch"
                ? "evidence_mismatch"
                : "error",
            family: "care",
            action,
            message: `${actionFailureMessage(error, "care", action)} ${
              authoritativeReload
                ? "Authoritative Firestore state was reloaded, but this transition remains unconfirmed. Controls stay locked until Retry completes a clean read."
                : "Authoritative Firestore state could not be reloaded. Controls stay locked; use Retry."
            }`,
          });
        }
      } finally {
        actionInFlight.current = false;
      }
    },
    [authority, load],
  );

  return {
    ...loadState,
    actionState,
    requestAutomationAction,
    requestCareAction,
    retry,
    reload: () => load(false),
  };
}
