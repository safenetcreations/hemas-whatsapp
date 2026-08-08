"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getLocalEmulatorFirestore } from "@/lib/firebase/auth-emulator";
import {
  AppointmentFunctionsClientError,
  requestSyntheticAppointmentThroughLocalFunctions,
} from "@/lib/firebase/appointment-functions-emulator";
import {
  type SyntheticAppointmentAction,
} from "@/lib/firebase/repositories";
import type { VerifiedWorkspaceSession } from "@/lib/firebase/workspace-session-model";
import {
  buildAppointmentActionRequest,
  describeAppointmentWorkspaceError,
  loadAppointmentWorkspace,
  type AppointmentScopePlan,
  type AppointmentWorkspaceRecord,
} from "./appointment-workspace-data";

type LoadState =
  | {
      readonly status: "loading";
      readonly records: readonly [];
      readonly scopePlan: null;
      readonly message: null;
    }
  | {
      readonly status: "ready";
      readonly records: readonly AppointmentWorkspaceRecord[];
      readonly scopePlan: AppointmentScopePlan;
      readonly message: null;
    }
  | {
      readonly status: "error";
      readonly records: readonly [];
      readonly scopePlan: null;
      readonly message: string;
    };

export type AppointmentActionState =
  | { readonly status: "idle"; readonly appointmentId: null; readonly message: null }
  | {
      readonly status: "working" | "success" | "replay" | "conflict" | "error";
      readonly appointmentId: string;
      readonly message: string;
    };

const initialLoadState: LoadState = {
  status: "loading",
  records: [],
  scopePlan: null,
  message: null,
};

const initialActionState: AppointmentActionState = {
  status: "idle",
  appointmentId: null,
  message: null,
};

function actionLabel(action: SyntheticAppointmentAction): string {
  return action === "request_reschedule" ? "reschedule" : "cancellation";
}

function actionFailureMessage(error: unknown, action: SyntheticAppointmentAction): string {
  const label = actionLabel(action);
  const code =
    error instanceof AppointmentFunctionsClientError
      ? error.code
      : typeof error === "object" && error && "code" in error
        ? String(error.code)
        : "";
  if (code === "idempotency_conflict") {
    return `The deterministic ${label} request identity is already bound to different durable evidence. No new transition was written.`;
  }
  if (code === "identity_mismatch" || code === "authentication_required") {
    return `The verified local Firebase Auth identity could not authorize this ${label} request. Sign in to the seeded emulator account again.`;
  }
  if (code === "permission_denied" || code === "service_denied") {
    return `The audited local Functions service refused this ${label} request under the verified workspace and route policy.`;
  }
  if (code === "emulator_unavailable") {
    return `The local Functions emulator could not process the ${label} request. No cloud fallback was attempted.`;
  }
  if (code === "invalid_request" || code === "invalid_response") {
    return `The audited ${label} contract failed strict validation. Authoritative Firestore evidence was not assumed.`;
  }
  if (code === "unsafe_endpoint") {
    return `The ${label} request was blocked because the endpoint was not the approved 127.0.0.1 Functions emulator.`;
  }
  return `The ${label} request was not completed by the audited local Functions transaction. No HIS, Meta, SMS, or email action was attempted.`;
}

export function useAppointmentWorkspace(session: VerifiedWorkspaceSession) {
  const [loadState, setLoadState] = useState<LoadState>(initialLoadState);
  const [actionState, setActionState] =
    useState<AppointmentActionState>(initialActionState);
  const loadSequence = useRef(0);
  const actionInFlight = useRef(false);
  const teamIdsKey = session.teamIds.join("\u001f");
  const locationIdsKey = session.locationIds.join("\u001f");

  const load = useCallback(
    async (showLoading = true): Promise<boolean> => {
      const request = ++loadSequence.current;
      if (showLoading) setLoadState(initialLoadState);
      try {
        const result = await loadAppointmentWorkspace(getLocalEmulatorFirestore(), {
          workspaceId: session.workspaceId,
          role: session.role,
          scopeMode: session.scopeMode,
          teamIds: teamIdsKey ? teamIdsKey.split("\u001f") : [],
          locationIds: locationIdsKey ? locationIdsKey.split("\u001f") : [],
        });
        if (request !== loadSequence.current) return false;
        setLoadState({
          status: "ready",
          records: result.records,
          scopePlan: result.scopePlan,
          message: null,
        });
        return true;
      } catch (error) {
        if (request !== loadSequence.current) return false;
        setLoadState({
          status: "error",
          records: [],
          scopePlan: null,
          message: describeAppointmentWorkspaceError(error),
        });
        return false;
      }
    }, [locationIdsKey, session.role, session.scopeMode, session.workspaceId, teamIdsKey],
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
      loadSequence.current += 1;
    };
  }, [load]);

  const retry = useCallback(() => {
    setActionState(initialActionState);
    void load();
  }, [load]);

  const requestAction = useCallback(
    async (
      record: AppointmentWorkspaceRecord,
      action: SyntheticAppointmentAction,
    ): Promise<void> => {
      if (actionInFlight.current) return;
      actionInFlight.current = true;
      const appointmentId = record.appointment.id;
      const label = actionLabel(action);
      setActionState({
        status: "working",
        appointmentId,
        message: `Calling one idempotent ${label} request through the audited local Functions transaction · externalCalls=0…`,
      });

      try {
        const request = await buildAppointmentActionRequest({
          session,
          appointment: record.appointment,
          action,
        });
        const response = await requestSyntheticAppointmentThroughLocalFunctions({
          actorUid: session.uid,
          request,
        });
        const reloaded = await load(false);
        if (!reloaded) {
          setActionState({
            status: "error",
            appointmentId,
            message:
              "The request returned, but authoritative emulator reload failed. Use Retry before relying on its state.",
          });
          return;
        }
        setActionState(
          response.replayed
            ? {
                status: "replay",
                appointmentId,
                message: `The audited local Functions transaction replayed the identical ${label} request safely; no duplicate event was created and externalCalls=0.`,
              }
            : {
                status: "success",
                appointmentId,
                message: `The audited local Functions transaction persisted the ${label} request, immutable event, idempotency record, and redacted audit atomically; externalCalls=0 and Hemas/HIS has not confirmed it.`,
              },
        );
      } catch (error) {
        const conflict =
          error instanceof AppointmentFunctionsClientError &&
          (error.code === "revision_conflict" || error.code === "idempotency_conflict");
        if (conflict) {
          const reloaded = await load(false);
          setActionState({
            status: reloaded ? "conflict" : "error",
            appointmentId,
            message: reloaded
              ? error.code === "revision_conflict"
                ? "Another audited transaction changed this simulator appointment. Authoritative Firestore emulator state was reloaded; review it before trying again."
                : "The deterministic request identity conflicted with durable evidence. Authoritative Firestore emulator state was reloaded and no new transition was assumed."
              : "A callable conflict occurred and the authoritative Firestore emulator state could not be reloaded. Use Retry.",
          });
        } else {
          setActionState({
            status: "error",
            appointmentId,
            message: actionFailureMessage(error, action),
          });
        }
      } finally {
        actionInFlight.current = false;
      }
    },
    [load, session],
  );

  return { ...loadState, actionState, requestAction, retry };
}
