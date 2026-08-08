import { assertDemoAuditEmulatorBoundary } from "../audit-firestore.js";
import { FailClosedError } from "../errors.js";
import { PUBLIC_SYNTHETIC_INGRESS_FIXTURE_SECRET } from "./contracts.js";

const DEMO_PROJECT_ID = "demo-hemas-connect";
const boundaries = new WeakSet<object>();
const authorizations = new WeakSet<object>();

export interface SyntheticIngressBoundary {
  readonly projectId: typeof DEMO_PROJECT_ID;
  readonly firestoreEmulatorHost: string;
  readonly syntheticFixtureSecret: typeof PUBLIC_SYNTHETIC_INGRESS_FIXTURE_SECRET;
}

export interface SyntheticPhoneRoute {
  readonly routeRef: string;
  readonly workspaceId: "workspace_safenet_demo";
  readonly connectionId: string;
  readonly teamId: string;
  readonly locationId: string;
}

export interface AuthorizedSyntheticIngressRoute {
  readonly boundary: SyntheticIngressBoundary;
  readonly route: SyntheticPhoneRoute;
}

const SYNTHETIC_PHONE_ROUTES: Readonly<Record<string, SyntheticPhoneRoute>> = Object.freeze({
  "synthetic-phone-route-wattala-demo": Object.freeze({
    routeRef: "synthetic-phone-route-wattala-demo",
    workspaceId: "workspace_safenet_demo",
    connectionId: "connection_demo_simulator",
    teamId: "team_demo_general",
    locationId: "location_demo_wattala",
  }),
  "synthetic-phone-route-thalawathugoda-demo": Object.freeze({
    routeRef: "synthetic-phone-route-thalawathugoda-demo",
    workspaceId: "workspace_safenet_demo",
    connectionId: "connection_demo_simulator",
    teamId: "team_demo_general",
    locationId: "location_demo_thalawathugoda",
  }),
});

function denyBoundary(): never {
  throw new FailClosedError(
    "synthetic_ingress_boundary_denied",
    "Synthetic ingress requires the explicit demo emulator boundary.",
  );
}

export function loadSyntheticIngressBoundary(
  env: NodeJS.ProcessEnv = process.env,
): SyntheticIngressBoundary {
  const gcloudProject = env.GCLOUD_PROJECT?.trim();
  const gcpProject = env.GCP_PROJECT?.trim();
  if (
    (gcloudProject && gcpProject && gcloudProject !== gcpProject) ||
    (gcloudProject ?? gcpProject) !== DEMO_PROJECT_ID ||
    env.HEMAS_RUNTIME_MODE !== "demo" ||
    env.HEMAS_PROVIDER_MODE !== "synthetic" ||
    env.HEMAS_INTEGRATION_MODE !== "synthetic" ||
    env.HEMAS_OUTBOUND_ENABLED !== "false" ||
    env.HEMAS_DIAGNOSIS_ENABLED !== "false" ||
    env.HEMAS_SYNTHETIC_INGRESS_SECRET !== PUBLIC_SYNTHETIC_INGRESS_FIXTURE_SECRET ||
    !env.FIRESTORE_EMULATOR_HOST
  ) {
    return denyBoundary();
  }
  try {
    assertDemoAuditEmulatorBoundary({
      projectId: gcloudProject ?? gcpProject ?? "",
      firestoreEmulatorHost: env.FIRESTORE_EMULATOR_HOST,
    });
  } catch {
    return denyBoundary();
  }
  const boundary: SyntheticIngressBoundary = Object.freeze({
    projectId: DEMO_PROJECT_ID,
    firestoreEmulatorHost: env.FIRESTORE_EMULATOR_HOST,
    syntheticFixtureSecret: PUBLIC_SYNTHETIC_INGRESS_FIXTURE_SECRET,
  });
  boundaries.add(boundary);
  return boundary;
}

export function authorizeSyntheticIngressRoute(
  boundary: SyntheticIngressBoundary,
  routeRef: string,
): AuthorizedSyntheticIngressRoute {
  if (!boundaries.has(boundary)) return denyBoundary();
  const route = SYNTHETIC_PHONE_ROUTES[routeRef];
  if (!route) {
    throw new FailClosedError(
      "synthetic_route_denied",
      "The synthetic server-side phone route is not allowlisted.",
    );
  }
  const authorization: AuthorizedSyntheticIngressRoute = Object.freeze({ boundary, route });
  authorizations.add(authorization);
  return authorization;
}

export function assertAuthorizedSyntheticIngressRoute(
  authorization: AuthorizedSyntheticIngressRoute,
): void {
  if (!authorizations.has(authorization) || !boundaries.has(authorization.boundary)) {
    denyBoundary();
  }
  const registered = SYNTHETIC_PHONE_ROUTES[authorization.route.routeRef];
  if (
    registered !== authorization.route ||
    authorization.route.workspaceId !== "workspace_safenet_demo"
  ) {
    denyBoundary();
  }
}
