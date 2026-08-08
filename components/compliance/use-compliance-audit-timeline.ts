"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  COMPLIANCE_AUDIT_PAGE_SIZE,
  ComplianceAuditFunctionsClientError,
  listComplianceAuditEventsThroughLocalFunctions,
  type ComplianceAuditCursor,
  type ComplianceAuditEvent,
  type ComplianceAuditFunctionsResponse,
  type ComplianceAuditOutcome,
} from "@/lib/firebase/compliance-audit-functions-emulator";
import type { VerifiedWorkspaceSession } from "@/lib/firebase/workspace-session-model";

export type ComplianceAuditTimelineState =
  | {
      readonly status: "loading";
      readonly events: readonly [];
      readonly nextCursor: null;
      readonly message: string;
    }
  | {
      readonly status: "ready";
      readonly events: readonly ComplianceAuditEvent[];
      readonly nextCursor: ComplianceAuditCursor | null;
      readonly message: null;
    }
  | {
      readonly status: "empty";
      readonly events: readonly [];
      readonly nextCursor: null;
      readonly message: string;
    }
  | {
      readonly status: "loading_more";
      readonly events: readonly ComplianceAuditEvent[];
      readonly nextCursor: ComplianceAuditCursor;
      readonly message: string;
    }
  | {
      readonly status: "pagination_error";
      readonly events: readonly ComplianceAuditEvent[];
      readonly nextCursor: ComplianceAuditCursor;
      readonly message: string;
    }
  | {
      readonly status: "denied" | "invalid_response" | "error";
      readonly events: readonly [];
      readonly nextCursor: null;
      readonly message: string;
    };

const loadingState: ComplianceAuditTimelineState = {
  status: "loading",
  events: [],
  nextCursor: null,
  message: "Loading the minimized synthetic audit timeline…",
};

export class ComplianceAuditTimelineError extends Error {
  constructor(readonly code: "invalid_page") {
    super("A Compliance audit page could not be joined safely.");
    this.name = "ComplianceAuditTimelineError";
  }
}

type RequestGate = {
  readonly begin: () => number;
  readonly isCurrent: (request: number) => boolean;
  readonly invalidate: () => void;
};

export function createComplianceAuditRequestGate(): RequestGate {
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

type AuditPosition = {
  readonly id: string;
  readonly occurredAt: string;
};

function compareDescendingPosition(
  prior: AuditPosition,
  next: AuditPosition,
): number {
  const priorMillis = Date.parse(prior.occurredAt);
  const nextMillis = Date.parse(next.occurredAt);
  if (priorMillis !== nextMillis) return nextMillis - priorMillis;
  if (prior.id === next.id) return 0;
  return prior.id > next.id ? -1 : 1;
}

export function appendComplianceAuditPage(
  existing: readonly ComplianceAuditEvent[],
  page: ComplianceAuditFunctionsResponse,
): readonly ComplianceAuditEvent[] {
  const seen = new Set(existing.map((event) => event.id));
  for (const event of page.events) {
    if (seen.has(event.id)) {
      throw new ComplianceAuditTimelineError("invalid_page");
    }
    seen.add(event.id);
  }
  const prior = existing.at(-1);
  const first = page.events.at(0);
  if (prior && first && compareDescendingPosition(prior, first) >= 0) {
    throw new ComplianceAuditTimelineError("invalid_page");
  }
  return [...existing, ...page.events];
}

function successfulState(
  page: ComplianceAuditFunctionsResponse,
): ComplianceAuditTimelineState {
  if (page.events.length === 0) {
    return {
      status: "empty",
      events: [],
      nextCursor: null,
      message: "No projected synthetic audit events match this outcome.",
    };
  }
  return {
    status: "ready",
    events: page.events,
    nextCursor: page.nextCursor,
    message: null,
  };
}

export function complianceAuditFailureState(
  error: unknown,
): Extract<
  ComplianceAuditTimelineState,
  { readonly status: "denied" | "invalid_response" | "error" }
> {
  const code =
    error instanceof ComplianceAuditTimelineError
      ? "invalid_response"
      : error instanceof ComplianceAuditFunctionsClientError
        ? error.code
        : "";
  if (
    code === "identity_mismatch" ||
    code === "authentication_required" ||
    code === "permission_denied"
  ) {
    return {
      status: "denied",
      events: [],
      nextCursor: null,
      message:
        "Timeline access changed or was denied. No projected audit events are shown.",
    };
  }
  if (code === "invalid_request" || code === "invalid_response") {
    return {
      status: "invalid_response",
      events: [],
      nextCursor: null,
      message:
        "The minimized audit contract failed strict validation. No projected events are shown.",
    };
  }
  return {
    status: "error",
    events: [],
    nextCursor: null,
    message:
      "The local minimized audit timeline is unavailable. No cloud or raw Firestore fallback was attempted.",
  };
}

export type ComplianceAuditPageLoader = typeof listComplianceAuditEventsThroughLocalFunctions;

export function useComplianceAuditTimeline(
  session: VerifiedWorkspaceSession,
  outcome: ComplianceAuditOutcome | null,
  loader: ComplianceAuditPageLoader =
    listComplianceAuditEventsThroughLocalFunctions,
) {
  const [state, setState] =
    useState<ComplianceAuditTimelineState>(loadingState);
  const [gate] = useState(createComplianceAuditRequestGate);
  const paginationRequest = useRef<number | null>(null);

  const loadInitial = useCallback(async (): Promise<void> => {
    paginationRequest.current = null;
    const request = gate.begin();
    setState(loadingState);
    try {
      const page = await loader({
        actorUid: session.uid,
        request: {
          workspaceId: session.workspaceId,
          outcome,
          pageSize: COMPLIANCE_AUDIT_PAGE_SIZE,
          cursor: null,
        },
      });
      if (!gate.isCurrent(request)) return;
      setState(successfulState(page));
    } catch (error) {
      if (!gate.isCurrent(request)) return;
      setState(complianceAuditFailureState(error));
    }
  }, [gate, loader, outcome, session.uid, session.workspaceId]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void loadInitial();
    });
    return () => {
      active = false;
      gate.invalidate();
      paginationRequest.current = null;
    };
  }, [gate, loadInitial]);

  const loadMore = useCallback(async (): Promise<void> => {
    if (
      paginationRequest.current !== null ||
      (state.status !== "ready" && state.status !== "pagination_error") ||
      state.nextCursor === null
    ) {
      return;
    }
    const existing = state.events;
    const cursor = state.nextCursor;
    const request = gate.begin();
    paginationRequest.current = request;
    setState({
      status: "loading_more",
      events: existing,
      nextCursor: cursor,
      message: "Loading the next minimized audit page…",
    });
    try {
      const page = await loader({
        actorUid: session.uid,
        request: {
          workspaceId: session.workspaceId,
          outcome,
          pageSize: COMPLIANCE_AUDIT_PAGE_SIZE,
          cursor,
        },
      });
      if (!gate.isCurrent(request)) return;
      const events = appendComplianceAuditPage(existing, page);
      setState({
        status: "ready",
        events,
        nextCursor: page.nextCursor,
        message: null,
      });
    } catch (error) {
      if (!gate.isCurrent(request)) return;
      const recoverableTransportFailure =
        error instanceof ComplianceAuditFunctionsClientError &&
        (error.code === "emulator_unavailable" ||
          error.code === "invocation_failed");
      if (recoverableTransportFailure) {
        setState({
          status: "pagination_error",
          events: existing,
          nextCursor: cursor,
          message:
            "The next page is unconfirmed. Previously verified events remain visible; retry before treating this timeline as complete.",
        });
        return;
      }
      setState(complianceAuditFailureState(error));
    } finally {
      if (paginationRequest.current === request) {
        paginationRequest.current = null;
      }
    }
  }, [gate, loader, outcome, session.uid, session.workspaceId, state]);

  return {
    state,
    refresh: loadInitial,
    loadMore,
  } as const;
}
