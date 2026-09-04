"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getLocalEmulatorFirestore } from "@/lib/firebase/auth-emulator";
import {
  CampaignFunctionsClientError,
  controlSyntheticCampaignThroughLocalFunctions,
} from "@/lib/firebase/campaign-functions-emulator";
import type { CampaignAction } from "@/lib/firebase/repositories";
import type { VerifiedWorkspaceSession } from "@/lib/firebase/workspace-session-model";
import {
  assertCampaignActionEvidence,
  buildCampaignActionRequest,
  CampaignWorkspaceDataError,
  describeCampaignWorkspaceError,
  loadCampaignWorkspace,
  readCampaignActionAuditEvidence,
  readCampaignActionImmutableEvidence,
  type CampaignWorkspaceRecord,
  type CampaignWorkspaceResult,
} from "./campaign-workspace-data";
import { FUNCTIONS_SOURCE } from "@/lib/firebase/boundary-copy";

export type CampaignWorkspaceLoadState =
  | { readonly status: "loading"; readonly result: null; readonly message: null }
  | {
      readonly status: "ready";
      readonly result: CampaignWorkspaceResult;
      readonly message: null;
    }
  | { readonly status: "denied"; readonly result: null; readonly message: string }
  | { readonly status: "error"; readonly result: null; readonly message: string };

const initialState: CampaignWorkspaceLoadState = {
  status: "loading",
  result: null,
  message: null,
};

export type CampaignActionState =
  | { readonly status: "idle"; readonly action: null; readonly message: null }
  | {
      readonly status: "working" | "success" | "replay" | "conflict" | "error";
      readonly action: CampaignAction;
      readonly message: string;
    };

const initialActionState: CampaignActionState = {
  status: "idle",
  action: null,
  message: null,
};

function actionLabel(action: CampaignAction): string {
  return action.replaceAll("_", " ");
}

function actionFailureMessage(error: unknown, action: CampaignAction): string {
  const label = actionLabel(action);
  const code =
    error instanceof CampaignFunctionsClientError ||
    error instanceof CampaignWorkspaceDataError
      ? error.code
      : typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : "";
  if (code === "identity_mismatch" || code === "authentication_required") {
    return `The verified Firebase Auth identity could not authorize ${label}. Sign in to the demo account again.`;
  }
  if (code === "permission_denied" || code === "access_denied") {
    return `The verified workspace role cannot request ${label} for this campaign.`;
  }
  if (code === "service_denied") {
    return `The audited synthetic campaign service refused ${label} in the current persisted state.`;
  }
  if (code === "emulator_unavailable") {
    return `${FUNCTIONS_SOURCE.charAt(0).toUpperCase()}${FUNCTIONS_SOURCE.slice(1)} could not process ${label}. No fallback was attempted.`;
  }
  if (code === "invalid_request" || code === "invalid_response") {
    return `The ${label} callable contract failed strict validation. No result was assumed.`;
  }
  if (code === "invalid_join" || code === "load_failed") {
    return `The ${label} response could not be matched to the persisted event, checkpoint, audit, and campaign evidence. Use Retry before relying on state.`;
  }
  if (code === "unsafe_endpoint") {
    return `${label} was blocked because the endpoint was not the approved governed Functions endpoint.`;
  }
  return `${label} did not complete through the audited local transaction. No Meta, Hemas, provider, or external action was attempted.`;
}

export function useCampaignWorkspace(session: VerifiedWorkspaceSession) {
  const [state, setState] = useState<CampaignWorkspaceLoadState>(initialState);
  const [actionState, setActionState] =
    useState<CampaignActionState>(initialActionState);
  const loadSequence = useRef(0);
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
    async (showLoading = true): Promise<boolean> => {
      const request = ++loadSequence.current;
      if (showLoading) setState(initialState);
      try {
        const result = await loadCampaignWorkspace(
          getLocalEmulatorFirestore(),
          authority,
        );
        if (request !== loadSequence.current) return false;
        setState({ status: "ready", result, message: null });
        return true;
      } catch (error) {
        if (request !== loadSequence.current) return false;
        setState({
          status:
            error instanceof CampaignWorkspaceDataError &&
            error.code === "access_denied"
              ? "denied"
              : "error",
          result: null,
          message: describeCampaignWorkspaceError(error),
        });
        return false;
      }
    },
    [authority],
  );

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) {
        setActionState(initialActionState);
        void load();
      }
    });
    return () => {
      active = false;
      loadSequence.current += 1;
    };
  }, [load]);

  const retry = useCallback(() => {
    setActionState(initialActionState);
    void load();
  }, [load]);

  const requestAction = useCallback(
    async (
      record: CampaignWorkspaceRecord,
      action: CampaignAction,
    ): Promise<void> => {
      if (actionInFlight.current) return;
      actionInFlight.current = true;
      const actionRequestSequence = ++loadSequence.current;
      const label = actionLabel(action);
      setActionState({
        status: "working",
        action,
        message: `Calling one revision-bound ${label} transaction on ${FUNCTIONS_SOURCE}…`,
      });

      try {
        const request = await buildCampaignActionRequest({
          session: authority,
          record,
          action,
        });
        const response = await controlSyntheticCampaignThroughLocalFunctions({
          actorUid: authority.uid,
          request,
        });
        const db = getLocalEmulatorFirestore();
        const [fresh, audit, immutable] = await Promise.all([
          loadCampaignWorkspace(db, authority),
          readCampaignActionAuditEvidence(db, {
            workspaceId: authority.workspaceId,
            auditEventId: response.auditEventId,
            actorUid: authority.uid,
          }),
          readCampaignActionImmutableEvidence(db, {
            workspaceId: authority.workspaceId,
            campaignId: response.result.campaignId,
            eventId: response.result.eventId,
            checkpointId: response.result.checkpointId,
          }),
        ]);
        if (actionRequestSequence !== loadSequence.current) return;
        if (!fresh.selected) {
          throw new CampaignWorkspaceDataError(
            "The campaign disappeared after the callable returned.",
            "invalid_join",
          );
        }
        // The strict workspace reload is authoritative even when the callable's
        // returned evidence is stale, substituted, or otherwise fails the
        // secondary reconciliation below. Installing it first prevents a stale
        // tab from presenting the same invalid action in a repeat loop.
        setState({ status: "ready", result: fresh, message: null });
        assertCampaignActionEvidence({
          session: authority,
          previous: record,
          current: fresh.selected,
          response,
          audit,
          immutable,
        });
        setActionState(
          response.replayed
            ? {
                status: "replay",
                action,
                message: `The identical ${label} request replayed safely. Its event, optional checkpoint, audit ID, and revision all match authoritative persisted evidence; externalCalls=0 and networkCalls=0.`,
              }
            : {
                status: "success",
                action,
                message: `${label} persisted atomically and the returned event, optional checkpoint, audit ID, and revision all match authoritative evidence; externalCalls=0 and networkCalls=0.`,
              },
        );
      } catch (error) {
        const conflict =
          error instanceof CampaignFunctionsClientError &&
          (error.code === "revision_conflict" ||
            error.code === "idempotency_conflict");
        if (conflict) {
          const reloaded = await load(false);
          setActionState({
            status: reloaded ? "conflict" : "error",
            action,
            message: reloaded
              ? "The deterministic request conflicted with newer durable evidence. Authoritative Firestore state was reloaded; review it before trying again."
              : "A callable conflict occurred and authoritative Firestore state could not be reloaded. Use Retry.",
          });
        } else {
          setActionState({
            status: "error",
            action,
            message: actionFailureMessage(error, action),
          });
        }
      } finally {
        actionInFlight.current = false;
      }
    },
    [authority, load],
  );

  return {
    ...state,
    actionState,
    requestAction,
    retry,
    reload: () => load(false),
  };
}
