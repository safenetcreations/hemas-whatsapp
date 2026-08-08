"use client";

import { useCallback, useEffect, useState } from "react";
import { getLocalEmulatorFirestore } from "@/lib/firebase/auth-emulator";
import type { WorkspaceRole } from "@/lib/firebase/workspace-session-model";
import type { InboxConversationRecord } from "./types";
import {
  describeInboxWorkspaceError,
  loadInboxWorkspace,
  type InboxScopePlan,
} from "./workspace-data";

type LoadState =
  | { readonly status: "loading"; readonly records: readonly []; readonly scopePlan: null; readonly message: null }
  | {
      readonly status: "ready";
      readonly records: readonly InboxConversationRecord[];
      readonly scopePlan: InboxScopePlan;
      readonly message: null;
    }
  | { readonly status: "error"; readonly records: readonly []; readonly scopePlan: null; readonly message: string };

const initialState: LoadState = {
  status: "loading",
  records: [],
  scopePlan: null,
  message: null,
};

export function useInboxWorkspace(input: {
  readonly workspaceId: string;
  readonly role: WorkspaceRole;
  readonly scopeMode: "assigned" | "workspace_wide";
  readonly teamIds: readonly string[];
  readonly locationIds: readonly string[];
}): LoadState & { readonly retry: () => void } {
  const [state, setState] = useState<LoadState>(initialState);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setState(initialState);
    setAttempt((current) => current + 1);
  }, []);
  const teamIdsKey = input.teamIds.join("\u001f");
  const locationIdsKey = input.locationIds.join("\u001f");

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) setState(initialState);
    });
    const authority = {
      workspaceId: input.workspaceId,
      role: input.role,
      scopeMode: input.scopeMode,
      teamIds: teamIdsKey ? teamIdsKey.split("\u001f") : [],
      locationIds: locationIdsKey ? locationIdsKey.split("\u001f") : [],
    } as const;

    void Promise.resolve().then(() =>
      loadInboxWorkspace(getLocalEmulatorFirestore(), authority),
    ).then(
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
          message: describeInboxWorkspaceError(error),
        });
      },
    );

    return () => {
      active = false;
    };
  }, [attempt, input.role, input.scopeMode, input.workspaceId, locationIdsKey, teamIdsKey]);

  return { ...state, retry };
}
