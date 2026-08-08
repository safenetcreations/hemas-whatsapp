"use client";

import { useCallback, useEffect, useState } from "react";

import {
  DEMO_CONNECTION_WORKSPACE_ID,
  type DemoConnectionCentreV1,
} from "@/lib/domain/connections";
import { getLocalEmulatorFirestore } from "@/lib/firebase/auth-emulator";
import {
  loadDemoConnectionCentre,
  type LoadDemoConnectionCentreInput,
} from "@/lib/firebase/repositories/connection-repository";
import type { VerifiedWorkspaceSession } from "@/lib/firebase/workspace-session-model";
import {
  ConnectionCentreClientError,
  connectionCentreAccess,
  connectionCentreFailure,
  validateConnectionCentreResult,
} from "./connection-centre-data";

export type ConnectionCentreLoadState =
  | {
      readonly status: "loading";
      readonly inventory: null;
      readonly message: string;
    }
  | {
      readonly status: "ready";
      readonly inventory: DemoConnectionCentreV1;
      readonly message: null;
    }
  | {
      readonly status: "empty";
      readonly inventory: DemoConnectionCentreV1;
      readonly message: string;
    }
  | {
      readonly status: "denied" | "invalid_response" | "error";
      readonly inventory: null;
      readonly message: string;
    };

const loadingState: ConnectionCentreLoadState = {
  status: "loading",
  inventory: null,
  message: "Loading the governed synthetic v1 inventory from local Firestore…",
};

export type ConnectionCentreRepositoryLoader = (
  input: LoadDemoConnectionCentreInput,
) => Promise<unknown>;

export async function loadConnectionCentreForAuthority(
  session: VerifiedWorkspaceSession,
  loader: ConnectionCentreRepositoryLoader,
): Promise<DemoConnectionCentreV1> {
  if (connectionCentreAccess(session) !== "allowed") {
    throw new ConnectionCentreClientError(
      "Verified authority cannot read the connection centre.",
      "access_denied",
    );
  }
  return validateConnectionCentreResult(
    await loader({ workspaceId: DEMO_CONNECTION_WORKSPACE_ID }),
  );
}

export type ConnectionCentreRequestGate = {
  readonly begin: () => number;
  readonly isCurrent: (request: number) => boolean;
  readonly invalidate: () => void;
};

export function createConnectionCentreRequestGate(): ConnectionCentreRequestGate {
  let current = 0;
  return {
    begin: () => {
      current += 1;
      return current;
    },
    isCurrent: (request) => request === current,
    invalidate: () => {
      current += 1;
    },
  };
}

function successfulState(
  inventory: DemoConnectionCentreV1,
): ConnectionCentreLoadState {
  if (
    inventory.whatsappConnections.length === 0 &&
    inventory.integrations.length === 0
  ) {
    return {
      status: "empty",
      inventory,
      message:
        "No governed synthetic v1 inventory is present in the local Firestore emulator. All three fixed records are absent; no connection state was inferred.",
    };
  }
  return { status: "ready", inventory, message: null };
}

export function useConnectionCentre(
  session: VerifiedWorkspaceSession,
  repositoryLoader: typeof loadDemoConnectionCentre = loadDemoConnectionCentre,
): ConnectionCentreLoadState & { readonly retry: () => void } {
  const [state, setState] = useState<ConnectionCentreLoadState>(loadingState);
  const [gate] = useState(createConnectionCentreRequestGate);

  const load = useCallback(async (): Promise<void> => {
    const request = gate.begin();
    setState(loadingState);
    try {
      const inventory = await loadConnectionCentreForAuthority(
        session,
        (input) => repositoryLoader(getLocalEmulatorFirestore(), input),
      );
      if (!gate.isCurrent(request)) return;
      setState(successfulState(inventory));
    } catch (error) {
      if (!gate.isCurrent(request)) return;
      const failure = connectionCentreFailure(error);
      setState({ ...failure, inventory: null });
    }
  }, [gate, repositoryLoader, session]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void load();
    });
    return () => {
      active = false;
      gate.invalidate();
    };
  }, [gate, load]);

  const retry = useCallback(() => {
    void load();
  }, [load]);

  return { ...state, retry };
}
