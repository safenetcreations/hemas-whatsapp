export { demoRequestSyntheticAppointment } from "./callable.js";
export {
  SYNTHETIC_APPOINTMENT_REQUEST_ACTIONS,
  assertSyntheticAppointmentRuntimeBoundary,
  parseStoredAppointmentRequestResult,
  parseStoredSyntheticAppointment,
  parseSyntheticAppointmentRequestInput,
  pendingStatusForAction,
  type SyntheticAppointmentPendingStatus,
  type SyntheticAppointmentRequestAction,
  type SyntheticAppointmentRequestInput,
  type SyntheticAppointmentRequestResult,
} from "./contracts.js";
export {
  requestSyntheticAppointmentAction,
  type SyntheticAppointmentRequestResponse,
} from "./service.js";
