export type FlowScreen = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly fields: readonly string[];
  readonly terminal: boolean;
};

export type SafeFlowRenderer = {
  readonly assetKey: string;
  readonly definitionId: string;
  readonly displayName: string;
  readonly version: 1;
  readonly flowScreens: readonly FlowScreen[];
  readonly fallback: string;
};

export type SafeTemplatePresentation = {
  readonly assetKey: string;
  readonly displayName: string;
  readonly fallback: string;
};

function screen(
  id: string,
  title: string,
  description: string,
  fields: readonly string[] = [],
  terminal = false,
): FlowScreen {
  return { id, title, description, fields, terminal };
}

/**
 * These definitions are inert render contracts, not catalogue fixtures. A Flow
 * is rendered only after a persisted Firestore record matches its definition,
 * language, version and complete ordered screen identity.
 */
export const safeFlowRenderers: readonly SafeFlowRenderer[] = [
  {
    assetKey: "doctor_booking_flow",
    definitionId: "synthetic-flow-appointment-request",
    displayName: "Appointment booking Flow",
    version: 1,
    flowScreens: [
      screen(
        "REQUEST_DETAILS",
        "Language and patient context",
        "Uses only a preferred language and masked synthetic context.",
        ["Preferred language", "Synthetic patient context"],
      ),
      screen(
        "LOCATION",
        "Hospital or location",
        "Shows only approved mock locations.",
        ["Hospital or location"],
      ),
      screen(
        "SPECIALTY",
        "Specialty or service",
        "Uses a neutral synthetic service catalogue without clinical routing claims.",
        ["Specialty or service"],
      ),
      screen(
        "DOCTOR",
        "Doctor preference",
        "Captures a preference only; it does not confirm availability.",
        ["Doctor preference"],
      ),
      screen(
        "DATE",
        "Preferred date",
        "Records a page-local date preference.",
        ["Preferred date"],
      ),
      screen(
        "SLOT",
        "Synthetic available slot",
        "Every displayed slot is explicitly fictional preview data.",
        ["Synthetic slot"],
      ),
      screen(
        "CONSENT",
        "Contact and consent notice",
        "Acknowledgement remains separate from marketing permission.",
        ["Notice acknowledgement"],
      ),
      screen(
        "REVIEW",
        "Review request",
        "Reviewing cannot create or confirm a Hemas appointment.",
        ["Request summary"],
      ),
      screen(
        "PENDING_CONFIRMATION",
        "Pending authoritative confirmation",
        "The local journey ends pending a future governed HIS adapter.",
        [],
        true,
      ),
    ],
    fallback:
      "Open the controlled web fallback or route to a human appointment agent without claiming that a booking exists.",
  },
  {
    assetKey: "home_collection_flow",
    definitionId: "synthetic-flow-laboratory-collection-request",
    displayName: "Home collection Flow",
    version: 1,
    flowScreens: [
      screen(
        "COLLECTION_MODE",
        "Centre visit or home collection",
        "Models a collection preference without scheduling a service.",
        ["Collection mode"],
      ),
      screen(
        "TEST",
        "Approved test or package",
        "Searches an approved synthetic catalogue only.",
        ["Test or package"],
      ),
      screen(
        "LOCATION",
        "Location or minimized address reference",
        "Avoids collecting a full address in the preview.",
        ["Location", "Synthetic address reference"],
      ),
      screen(
        "DATE",
        "Preferred date",
        "Records a page-local date preference.",
        ["Preferred date"],
      ),
      screen(
        "SLOT",
        "Synthetic available slot",
        "Every displayed window is fictional preview data.",
        ["Synthetic collection window"],
      ),
      screen(
        "PREPARATION",
        "Approved preparation summary",
        "Shows neutral pre-approved information and never interprets results.",
        ["Preparation acknowledgement"],
      ),
      screen(
        "CONSENT",
        "Contact and consent notice",
        "Does not collect reports, diagnoses, payment-card details or provider payloads.",
        ["Contact acknowledgement", "Consent acknowledgement"],
      ),
      screen(
        "REVIEW",
        "Review collection request",
        "Reviewing cannot create a laboratory or home-collection booking.",
        ["Request summary"],
      ),
      screen(
        "PENDING_CONFIRMATION",
        "Pending authoritative confirmation",
        "The local journey ends pending a future governed laboratory adapter.",
        [],
        true,
      ),
    ],
    fallback:
      "Route to a laboratory agent without disclosing clinical content or claiming that collection is scheduled.",
  },
  {
    assetKey: "appointment_change_flow",
    definitionId: "synthetic-flow-appointment-change",
    displayName: "Reschedule or cancel Flow",
    version: 1,
    flowScreens: [
      screen(
        "APPOINTMENT",
        "Secure appointment selection",
        "Uses only an opaque synthetic appointment reference.",
        ["Synthetic appointment reference"],
      ),
      screen(
        "CHANGE_ACTION",
        "Reschedule or cancel",
        "Models a requested action without changing an appointment system.",
        ["Requested action"],
      ),
      screen(
        "REASON",
        "Optional minimized reason",
        "Uses a neutral reason category and does not request clinical detail.",
        ["Optional reason category"],
      ),
      screen(
        "NEW_DATE",
        "New date when rescheduling",
        "Appears only in the local reschedule preview.",
        ["Preferred new date"],
      ),
      screen(
        "NEW_SLOT",
        "New synthetic slot",
        "The slot is fictional and does not reserve availability.",
        ["Synthetic slot"],
      ),
      screen(
        "REVIEW",
        "Review change request",
        "The request remains pending until a future authoritative adapter accepts it.",
        ["Change summary"],
      ),
      screen(
        "PENDING_CONFIRMATION",
        "Pending authoritative confirmation",
        "No booking change is claimed by this local preview.",
        [],
        true,
      ),
    ],
    fallback:
      "Preserve the request and route to an appointment agent; do not claim that the booking changed.",
  },
  {
    assetKey: "package_enquiry_flow",
    definitionId: "synthetic-flow-package-enquiry",
    displayName: "Package enquiry Flow",
    version: 1,
    flowScreens: [
      screen(
        "PACKAGE_CATEGORY",
        "Package category",
        "Uses approved synthetic categories without suitability claims.",
        ["Package category"],
      ),
      screen(
        "PACKAGE_SUMMARY",
        "Approved package summary",
        "Price and inclusions are clearly fictional preview values.",
        ["Synthetic package summary"],
      ),
      screen(
        "LOCATION",
        "Preferred hospital",
        "Records a page-local location preference.",
        ["Preferred hospital"],
      ),
      screen(
        "DATE",
        "Preferred date",
        "Records a page-local date preference.",
        ["Preferred date"],
      ),
      screen(
        "CONTACT",
        "Contact acknowledgement",
        "Keeps contact acknowledgement separate from marketing consent.",
        ["Contact acknowledgement"],
      ),
      screen(
        "PAYMENT_HANDOFF",
        "Optional secure payment handoff notice",
        "No payment data is collected and no payment action is available.",
        ["Handoff acknowledgement"],
      ),
      screen(
        "REVIEW",
        "Review enquiry",
        "Reviewing cannot create an order, booking or payment.",
        ["Enquiry summary"],
      ),
      screen(
        "PENDING_CONFIRMATION",
        "Pending authoritative confirmation",
        "The local enquiry remains unsubmitted to any external system.",
        [],
        true,
      ),
    ],
    fallback:
      "Route to a service agent without recommending clinical suitability or accepting payment data.",
  },
  {
    assetKey: "service_feedback_flow",
    definitionId: "synthetic-flow-feedback",
    displayName: "Service feedback Flow",
    version: 1,
    flowScreens: [
      screen(
        "SERVICE_REFERENCE",
        "Service or appointment reference",
        "Uses only an opaque synthetic reference.",
        ["Synthetic service reference"],
      ),
      screen(
        "SATISFACTION",
        "Satisfaction score",
        "A low score can create only a local service-recovery preview.",
        ["Satisfaction score"],
      ),
      screen(
        "REASONS",
        "Reason categories",
        "Uses neutral categories without clinical interpretation.",
        ["Reason categories"],
      ),
      screen(
        "OPTIONAL_COMMENT",
        "Optional feedback",
        "Prompts the user not to include medical, report or other sensitive content.",
        ["Optional feedback"],
      ),
      screen(
        "CONTACT_PERMISSION",
        "Permission to contact",
        "Contact permission is separate from testimonial and marketing permission.",
        ["Permission to contact"],
      ),
      screen(
        "REVIEW",
        "Review feedback",
        "Feedback remains page-local and cannot be published or sent.",
        ["Feedback summary"],
      ),
      screen(
        "PENDING_CONFIRMATION",
        "Pending service review",
        "No service-recovery action is claimed by this preview.",
        [],
        true,
      ),
    ],
    fallback:
      "Route urgent or clinical content to the governed human queue; never publish feedback automatically.",
  },
  {
    assetKey: "communication_preferences_flow",
    definitionId: "synthetic-flow-communication-preferences",
    displayName: "Communication preferences Flow",
    version: 1,
    flowScreens: [
      screen(
        "LANGUAGE",
        "Preferred language",
        "Sets a page-local communication preference only.",
        ["Preferred language"],
      ),
      screen(
        "UTILITY",
        "Utility categories",
        "Keeps service updates separate from marketing.",
        ["Appointment updates", "Laboratory updates"],
      ),
      screen(
        "EDUCATION",
        "Education categories",
        "Uses neutral approved categories.",
        ["Education categories"],
      ),
      screen(
        "MARKETING",
        "Marketing categories",
        "All marketing choices are unselected by default in the preview.",
        ["Marketing categories"],
      ),
      screen(
        "FREQUENCY",
        "Frequency preferences",
        "Frequency is a separate page-local preference.",
        ["Frequency"],
      ),
      screen(
        "REVIEW",
        "Review preferences",
        "Withdrawal is presented as clearly as opt-in, but nothing is saved.",
        ["Notice acknowledgement"],
      ),
      screen(
        "PENDING_CONFIRMATION",
        "Pending preference update",
        "Existing suppression state remains authoritative until a governed write succeeds.",
        [],
        true,
      ),
    ],
    fallback:
      "Keep the existing suppression state and route ambiguous consent changes to privacy operations.",
  },
];

export const safeTemplatePresentations: readonly SafeTemplatePresentation[] = [
  {
    assetKey: "appointment_confirmation",
    displayName: "Appointment confirmation",
    fallback: "Route to the appointments queue with the conversation context.",
  },
  {
    assetKey: "lab_report_ready",
    displayName: "Lab report-ready notice",
    fallback: "Offer human assistance. Never attach or interpret a report.",
  },
  {
    assetKey: "wellness_awareness",
    displayName: "Wellness awareness",
    fallback: "Do not send if marketing consent or language preference is unknown.",
  },
];

const flowRendererByDefinitionId = new Map(
  safeFlowRenderers.map((renderer) => [renderer.definitionId, renderer]),
);
const templatePresentationByAssetKey = new Map(
  safeTemplatePresentations.map((presentation) => [presentation.assetKey, presentation]),
);

export function getSafeFlowRenderer(
  definitionId: string,
): SafeFlowRenderer | undefined {
  return flowRendererByDefinitionId.get(definitionId);
}

export function getSafeTemplatePresentation(
  assetKey: string,
): SafeTemplatePresentation | undefined {
  return templatePresentationByAssetKey.get(assetKey);
}
