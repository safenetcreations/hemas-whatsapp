"use client";

import { useCallback, useEffect, useState } from "react";
import { getLocalEmulatorFirestore } from "@/lib/firebase/auth-emulator";
import type { VerifiedWorkspaceSession } from "@/lib/firebase/workspace-session-model";
import {
  describeLaboratoryWorkspaceError,
  loadLaboratoryWorkspace,
  type LaboratoryWorkflowView,
  type LaboratoryWorkspaceResult,
} from "./laboratory-workspace-data";

type LaboratoryLoadState =
  | {
      readonly status: "idle" | "loading";
      readonly records: readonly [];
      readonly scopePlan: null;
      readonly message: null;
    }
  | {
      readonly status: "ready";
      readonly records: readonly LaboratoryWorkflowView[];
      readonly scopePlan: LaboratoryWorkspaceResult["scopePlan"];
      readonly message: null;
    }
  | {
      readonly status: "error";
      readonly records: readonly [];
      readonly scopePlan: null;
      readonly message: string;
    };

const idleState: LaboratoryLoadState = {
  status: "idle",
  records: [],
  scopePlan: null,
  message: null,
};

const loadingState: LaboratoryLoadState = {
  status: "loading",
  records: [],
  scopePlan: null,
  message: null,
};

export function useLaboratoryWorkspace(
  session: VerifiedWorkspaceSession | null,
): LaboratoryLoadState & { readonly retry: () => void } {
  const [state, setState] = useState<LaboratoryLoadState>(idleState);
  const [attempt, setAttempt] = useState(0);
  const workspaceId = session?.workspaceId ?? "";
  const role = session?.role ?? null;
  const scopeMode = session?.scopeMode ?? null;
  const teamIdsKey = session?.teamIds.join("\u001f") ?? "";
  const locationIdsKey = session?.locationIds.join("\u001f") ?? "";
  const retry = useCallback(() => {
    if (!workspaceId) return;
    setState(loadingState);
    setAttempt((current) => current + 1);
  }, [workspaceId]);

  useEffect(() => {
    let active = true;
    if (!workspaceId || !role || !scopeMode) {
      queueMicrotask(() => {
        if (active) setState(idleState);
      });
      return () => {
        active = false;
      };
    }

    const authority = {
      workspaceId,
      role,
      scopeMode,
      teamIds: teamIdsKey ? teamIdsKey.split("\u001f") : [],
      locationIds: locationIdsKey ? locationIdsKey.split("\u001f") : [],
    } as const;
    queueMicrotask(() => {
      if (active) setState(loadingState);
    });

    void Promise.resolve()
      .then(() => loadLaboratoryWorkspace(getLocalEmulatorFirestore(), authority))
      .then(
        (result) => {
          if (!active) return;
          setState({
            status: "ready",
            records: result.records,
            scopePlan: result.scopePlan,
            message: null,
          });
        },
        (error: unknown) => {
          if (!active) return;
          setState({
            status: "error",
            records: [],
            scopePlan: null,
            message: describeLaboratoryWorkspaceError(error),
          });
        },
      );

    return () => {
      active = false;
    };
  }, [attempt, locationIdsKey, role, scopeMode, teamIdsKey, workspaceId]);

  return { ...state, retry };
}
