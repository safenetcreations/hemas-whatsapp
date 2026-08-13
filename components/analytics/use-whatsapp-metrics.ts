"use client";

import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getLocalEmulatorFirestore } from "@/lib/firebase/auth-emulator";
import {
  parseWhatsAppMetricDocuments,
  type WhatsAppDailyMetric,
} from "./whatsapp-metrics-model";

const SERVER_SNAPSHOT_TIMEOUT_MS = 7_500;

type MetricsStatus = "loading" | "ready" | "empty" | "error";

interface MetricsState {
  readonly workspaceId: string | null;
  readonly status: MetricsStatus;
  readonly rows: readonly WhatsAppDailyMetric[];
  readonly message: string | null;
}

export interface WhatsAppMetricsSnapshot {
  readonly status: MetricsStatus;
  readonly rows: readonly WhatsAppDailyMetric[];
  readonly message: string | null;
  readonly retry: () => void;
}

function loadingState(workspaceId: string | null): MetricsState {
  return { workspaceId, status: "loading", rows: [], message: null };
}

function errorState(workspaceId: string, message: string): MetricsState {
  return { workspaceId, status: "error", rows: [], message };
}

export function useWhatsAppMetrics(workspaceId: string | null): WhatsAppMetricsSnapshot {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<MetricsState>(() => loadingState(workspaceId));

  const retry = useCallback(() => {
    setState(loadingState(workspaceId));
    setAttempt((current) => current + 1);
  }, [workspaceId]);

  useEffect(() => {
    let active = true;

    if (!workspaceId) {
      queueMicrotask(() => {
        if (active) setState(loadingState(null));
      });
      return () => {
        active = false;
      };
    }

    queueMicrotask(() => {
      if (active) setState(loadingState(workspaceId));
    });

    let db;
    try {
      db = getLocalEmulatorFirestore();
    } catch {
      queueMicrotask(() => {
        if (!active) return;
        setState(
          errorState(
            workspaceId,
            "Automatic aggregate metrics are unavailable in this approved demo runtime.",
          ),
        );
      });
      return () => {
        active = false;
      };
    }

    const metricsQuery = query(
      collection(db, "workspaces", workspaceId, "canary_metrics"),
      orderBy("day", "desc"),
      limit(14),
    );

    let verifiedServerSnapshot = false;
    const timeout = window.setTimeout(() => {
      if (!active || verifiedServerSnapshot) return;
      setState(
        errorState(
          workspaceId,
          "A verified Firestore metrics snapshot did not arrive. Check the demo data connection, then retry.",
        ),
      );
    }, SERVER_SNAPSHOT_TIMEOUT_MS);

    const unsubscribe = onSnapshot(
      metricsQuery,
      { includeMetadataChanges: true },
      (snapshot) => {
        if (!active || snapshot.metadata.fromCache) return;
        verifiedServerSnapshot = true;
        window.clearTimeout(timeout);
        try {
          const rows = parseWhatsAppMetricDocuments(
            snapshot.docs.map((record) => ({ id: record.id, data: record.data() })),
            workspaceId,
          );
          setState({
            workspaceId,
            status: rows.length === 0 ? "empty" : "ready",
            rows,
            message: null,
          });
        } catch {
          setState(
            errorState(
              workspaceId,
              "The aggregate metrics feed failed validation, so no partial values are shown.",
            ),
          );
        }
      },
      () => {
        if (!active) return;
        window.clearTimeout(timeout);
        setState(
          errorState(
            workspaceId,
            "Automatic aggregate metrics could not be read for this workspace. Check access and retry.",
          ),
        );
      },
    );

    return () => {
      active = false;
      window.clearTimeout(timeout);
      unsubscribe();
    };
  }, [attempt, workspaceId]);

  return useMemo(() => {
    const visibleState = state.workspaceId === workspaceId ? state : loadingState(workspaceId);
    return {
      status: visibleState.status,
      rows: visibleState.rows,
      message: visibleState.message,
      retry,
    };
  }, [retry, state, workspaceId]);
}
