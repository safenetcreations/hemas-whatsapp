import { FailClosedError } from "../errors.js";
import type { SyntheticFlowPurpose } from "./token.js";

export const SYNTHETIC_FLOW_DEFINITION_SCHEMA = "hemas.synthetic.flow-definition" as const;
export const SYNTHETIC_FLOW_DEFINITION_VERSION = 1 as const;

export type SyntheticFlowDataMode = "static" | "endpoint_powered";
export type SyntheticFlowAction = "continue" | "submit_pending";
export type SyntheticFlowField =
  | "language"
  | "patient_context"
  | "location"
  | "specialty"
  | "doctor"
  | "date"
  | "slot"
  | "consent_acknowledgement"
  | "appointment_reference"
  | "change_action"
  | "reason_category"
  | "collection_mode"
  | "test_or_package"
  | "address_reference"
  | "preparation_acknowledgement"
  | "contact_acknowledgement"
  | "package_category"
  | "payment_handoff_acknowledgement"
  | "service_reference"
  | "satisfaction_score"
  | "reason_categories"
  | "optional_feedback"
  | "contact_permission"
  | "utility_categories"
  | "education_categories"
  | "marketing_categories"
  | "frequency";

export interface SyntheticFlowScreenDefinition {
  readonly id: string;
  readonly label: string;
  readonly fields: readonly SyntheticFlowField[];
  readonly terminal: boolean;
  readonly allowedActions: readonly SyntheticFlowAction[];
}

export interface SyntheticFlowDefinition {
  readonly schema: typeof SYNTHETIC_FLOW_DEFINITION_SCHEMA;
  readonly version: typeof SYNTHETIC_FLOW_DEFINITION_VERSION;
  readonly revision: "1.0";
  readonly noticeVersion: "demo-notice-v1" | null;
  readonly id: string;
  readonly name: string;
  readonly mode: "demo";
  readonly dataMode: SyntheticFlowDataMode;
  readonly purpose: SyntheticFlowPurpose;
  readonly initialScreen: string;
  readonly screens: readonly SyntheticFlowScreenDefinition[];
  readonly synthetic: true;
  readonly acceptsProviderPayloads: false;
  readonly performsNetworkCalls: false;
  readonly confirmsHemasTransaction: false;
  readonly persistsSubmittedValues: false;
  readonly clinicalDecisioningAllowed: false;
  readonly marketingDefaultsSelected: false;
}

type ScreenInput = Readonly<{
  id: string;
  label: string;
  fields?: readonly SyntheticFlowField[];
  action?: SyntheticFlowAction;
  terminal?: boolean;
}>;

function screen(input: ScreenInput): SyntheticFlowScreenDefinition {
  return Object.freeze({
    id: input.id,
    label: input.label,
    fields: Object.freeze([...(input.fields ?? [])]),
    terminal: input.terminal ?? false,
    allowedActions: Object.freeze(input.action ? [input.action] : []),
  });
}

function endpointDefinition(input: Readonly<{
  id: string;
  name: string;
  purpose: Exclude<SyntheticFlowPurpose, "service_information">;
  screens: readonly SyntheticFlowScreenDefinition[];
}>): SyntheticFlowDefinition {
  return Object.freeze({
    schema: SYNTHETIC_FLOW_DEFINITION_SCHEMA,
    version: SYNTHETIC_FLOW_DEFINITION_VERSION,
    revision: "1.0",
    noticeVersion: "demo-notice-v1",
    id: input.id,
    name: input.name,
    mode: "demo",
    dataMode: "endpoint_powered",
    purpose: input.purpose,
    initialScreen: input.screens[0]?.id ?? "",
    screens: Object.freeze([...input.screens]),
    synthetic: true,
    acceptsProviderPayloads: false,
    performsNetworkCalls: false,
    confirmsHemasTransaction: false,
    persistsSubmittedValues: false,
    clinicalDecisioningAllowed: false,
    marketingDefaultsSelected: false,
  });
}

const STATIC_SERVICE_INFORMATION_FLOW: SyntheticFlowDefinition = Object.freeze({
  schema: SYNTHETIC_FLOW_DEFINITION_SCHEMA,
  version: SYNTHETIC_FLOW_DEFINITION_VERSION,
  revision: "1.0",
  noticeVersion: null,
  id: "synthetic-flow-service-information",
  name: "Synthetic service information",
  mode: "demo",
  dataMode: "static",
  purpose: "service_information",
  initialScreen: "SERVICE_OVERVIEW",
  screens: Object.freeze([
    screen({
      id: "SERVICE_OVERVIEW",
      label: "Approved service information",
      terminal: true,
    }),
  ]),
  synthetic: true,
  acceptsProviderPayloads: false,
  performsNetworkCalls: false,
  confirmsHemasTransaction: false,
  persistsSubmittedValues: false,
  clinicalDecisioningAllowed: false,
  marketingDefaultsSelected: false,
});

const APPOINTMENT_REQUEST_FLOW = endpointDefinition({
  id: "synthetic-flow-appointment-request",
  name: "Doctor appointment request",
  purpose: "appointment_request",
  screens: [
    screen({ id: "REQUEST_DETAILS", label: "Language and patient context", fields: ["language", "patient_context"], action: "continue" }),
    screen({ id: "LOCATION", label: "Hospital or location", fields: ["location"], action: "continue" }),
    screen({ id: "SPECIALTY", label: "Specialty or service", fields: ["specialty"], action: "continue" }),
    screen({ id: "DOCTOR", label: "Doctor preference", fields: ["doctor"], action: "continue" }),
    screen({ id: "DATE", label: "Preferred date", fields: ["date"], action: "continue" }),
    screen({ id: "SLOT", label: "Synthetic available slot", fields: ["slot"], action: "continue" }),
    screen({ id: "CONSENT", label: "Contact and consent notice", fields: ["consent_acknowledgement"], action: "continue" }),
    screen({ id: "REVIEW", label: "Review request", action: "submit_pending" }),
    screen({ id: "PENDING_CONFIRMATION", label: "Pending authoritative confirmation", terminal: true }),
  ],
});

const APPOINTMENT_CHANGE_FLOW = endpointDefinition({
  id: "synthetic-flow-appointment-change",
  name: "Appointment reschedule or cancellation request",
  purpose: "appointment_change_request",
  screens: [
    screen({ id: "APPOINTMENT", label: "Secure appointment selection", fields: ["appointment_reference"], action: "continue" }),
    screen({ id: "CHANGE_ACTION", label: "Reschedule or cancel", fields: ["change_action"], action: "continue" }),
    screen({ id: "REASON", label: "Optional minimized reason", fields: ["reason_category"], action: "continue" }),
    screen({ id: "NEW_DATE", label: "New date when rescheduling", fields: ["date"], action: "continue" }),
    screen({ id: "NEW_SLOT", label: "New synthetic slot", fields: ["slot"], action: "continue" }),
    screen({ id: "REVIEW", label: "Review change request", action: "submit_pending" }),
    screen({ id: "PENDING_CONFIRMATION", label: "Pending authoritative confirmation", terminal: true }),
  ],
});

const LABORATORY_COLLECTION_FLOW = endpointDefinition({
  id: "synthetic-flow-laboratory-collection-request",
  name: "Laboratory or home collection request",
  purpose: "laboratory_collection_request",
  screens: [
    screen({ id: "COLLECTION_MODE", label: "Centre visit or home collection", fields: ["collection_mode"], action: "continue" }),
    screen({ id: "TEST", label: "Approved test or package", fields: ["test_or_package"], action: "continue" }),
    screen({ id: "LOCATION", label: "Location or minimized address reference", fields: ["location", "address_reference"], action: "continue" }),
    screen({ id: "DATE", label: "Preferred date", fields: ["date"], action: "continue" }),
    screen({ id: "SLOT", label: "Synthetic available slot", fields: ["slot"], action: "continue" }),
    screen({ id: "PREPARATION", label: "Approved preparation summary", fields: ["preparation_acknowledgement"], action: "continue" }),
    screen({ id: "CONSENT", label: "Contact and consent notice", fields: ["contact_acknowledgement", "consent_acknowledgement"], action: "continue" }),
    screen({ id: "REVIEW", label: "Review collection request", action: "submit_pending" }),
    screen({ id: "PENDING_CONFIRMATION", label: "Pending authoritative confirmation", terminal: true }),
  ],
});

const PACKAGE_ENQUIRY_FLOW = endpointDefinition({
  id: "synthetic-flow-package-enquiry",
  name: "Health package enquiry",
  purpose: "package_enquiry",
  screens: [
    screen({ id: "PACKAGE_CATEGORY", label: "Package category", fields: ["package_category"], action: "continue" }),
    screen({ id: "PACKAGE_SUMMARY", label: "Approved package summary", action: "continue" }),
    screen({ id: "LOCATION", label: "Preferred hospital", fields: ["location"], action: "continue" }),
    screen({ id: "DATE", label: "Preferred date", fields: ["date"], action: "continue" }),
    screen({ id: "CONTACT", label: "Contact acknowledgement", fields: ["contact_acknowledgement"], action: "continue" }),
    screen({ id: "PAYMENT_HANDOFF", label: "Optional secure payment handoff notice", fields: ["payment_handoff_acknowledgement"], action: "continue" }),
    screen({ id: "REVIEW", label: "Review enquiry", action: "submit_pending" }),
    screen({ id: "PENDING_CONFIRMATION", label: "Pending authoritative confirmation", terminal: true }),
  ],
});

const FEEDBACK_FLOW = endpointDefinition({
  id: "synthetic-flow-feedback",
  name: "Service feedback",
  purpose: "feedback",
  screens: [
    screen({ id: "SERVICE_REFERENCE", label: "Service or appointment reference", fields: ["service_reference"], action: "continue" }),
    screen({ id: "SATISFACTION", label: "Satisfaction score", fields: ["satisfaction_score"], action: "continue" }),
    screen({ id: "REASONS", label: "Reason categories", fields: ["reason_categories"], action: "continue" }),
    screen({ id: "OPTIONAL_COMMENT", label: "Optional feedback without clinical detail", fields: ["optional_feedback"], action: "continue" }),
    screen({ id: "CONTACT_PERMISSION", label: "Permission to contact", fields: ["contact_permission"], action: "continue" }),
    screen({ id: "REVIEW", label: "Review feedback", action: "submit_pending" }),
    screen({ id: "PENDING_CONFIRMATION", label: "Pending service review", terminal: true }),
  ],
});

const COMMUNICATION_PREFERENCES_FLOW = endpointDefinition({
  id: "synthetic-flow-communication-preferences",
  name: "Communication preferences",
  purpose: "communication_preferences",
  screens: [
    screen({ id: "LANGUAGE", label: "Preferred language", fields: ["language"], action: "continue" }),
    screen({ id: "UTILITY", label: "Utility categories", fields: ["utility_categories"], action: "continue" }),
    screen({ id: "EDUCATION", label: "Education categories", fields: ["education_categories"], action: "continue" }),
    screen({ id: "MARKETING", label: "Marketing categories unselected by default", fields: ["marketing_categories"], action: "continue" }),
    screen({ id: "FREQUENCY", label: "Frequency preferences", fields: ["frequency"], action: "continue" }),
    screen({ id: "REVIEW", label: "Review preferences", action: "submit_pending" }),
    screen({ id: "PENDING_CONFIRMATION", label: "Pending preference update", terminal: true }),
  ],
});

export const SYNTHETIC_FLOW_DEFINITIONS: readonly SyntheticFlowDefinition[] = Object.freeze([
  STATIC_SERVICE_INFORMATION_FLOW,
  APPOINTMENT_REQUEST_FLOW,
  APPOINTMENT_CHANGE_FLOW,
  LABORATORY_COLLECTION_FLOW,
  PACKAGE_ENQUIRY_FLOW,
  FEEDBACK_FLOW,
  COMMUNICATION_PREFERENCES_FLOW,
]);

export function getSyntheticFlowDefinition(definitionId: string): SyntheticFlowDefinition {
  const definition = SYNTHETIC_FLOW_DEFINITIONS.find((candidate) => candidate.id === definitionId);
  if (!definition) {
    throw new FailClosedError("unknown_flow_definition", "Synthetic flow definition is unknown.");
  }
  return definition;
}
