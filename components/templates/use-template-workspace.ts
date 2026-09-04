"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getLocalEmulatorFirestore } from "@/lib/firebase/auth-emulator";
import { TOLERANT_READS } from "@/lib/firebase/boundary-copy";
import type { VerifiedWorkspaceSession } from "@/lib/firebase/workspace-session-model";
import {
  describeTemplateWorkspaceError,
  loadTemplateWorkspace,
  TemplateWorkspaceDataError,
  type TemplateWorkspaceResult,
} from "./template-workspace-data";

export type TemplateWorkspaceLoadState =
  | {
      readonly status: "loading";
      readonly result: null;
      readonly message: null;
    }
  | {
      readonly status: "ready";
      readonly result: TemplateWorkspaceResult;
      readonly message: null;
    }
  | {
      readonly status: "denied";
      readonly result: null;
      readonly message: string;
    }
  | {
      readonly status: "error";
      readonly result: null;
      readonly message: string;
    };

const initialState: TemplateWorkspaceLoadState = {
  status: "loading",
  result: null,
  message: null,
};

export function useTemplateWorkspace(
  session: VerifiedWorkspaceSession,
): TemplateWorkspaceLoadState & { readonly retry: () => void } {
  const [state, setState] = useState<TemplateWorkspaceLoadState>(initialState);
  const [attempt, setAttempt] = useState(0);
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

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) setState(initialState);
    });
    void Promise.resolve()
      .then(() =>
        loadTemplateWorkspace(getLocalEmulatorFirestore(), authority, undefined, {
          tolerant: TOLERANT_READS,
        }),
      )
      .then(
        (result) => {
          if (!active) return;
          setState({ status: "ready", result, message: null });
        },
        (error: unknown) => {
          if (!active) return;
          setState({
            status:
              error instanceof TemplateWorkspaceDataError &&
              error.code === "access_denied"
                ? "denied"
                : "error",
            result: null,
            message: describeTemplateWorkspaceError(error),
          });
        },
      );
    return () => {
      active = false;
    };
  }, [attempt, authority]);

  const retry = useCallback(() => {
    setState(initialState);
    setAttempt((current) => current + 1);
  }, []);

  return { ...state, retry };
}
