from __future__ import annotations

from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import (
    BaseDocTemplate,
    Flowable,
    Frame,
    Image,
    KeepTogether,
    NextPageTemplate,
    PageBreak,
    PageTemplate,
    Paragraph,
    Preformatted,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output" / "pdf" / "Hemas_Enterprise_WhatsApp_API_Technical_Proof_Pack.pdf"
HEMAS_LOGO = ROOT / "public" / "hemas-logo.png"

PAGE_W, PAGE_H = A4
LEFT = 21 * mm
RIGHT = 16 * mm
TOP = 19 * mm
BOTTOM = 17 * mm
BODY_W = PAGE_W - LEFT - RIGHT

NAVY = colors.HexColor("#102A56")
BLUE = colors.HexColor("#1468D4")
CYAN = colors.HexColor("#1DB5CC")
GREEN = colors.HexColor("#138A69")
ORANGE = colors.HexColor("#F07D2F")
INK = colors.HexColor("#17243A")
TEXT = colors.HexColor("#334663")
MUTED = colors.HexColor("#65758D")
LINE = colors.HexColor("#D8E2EE")
PALE_BLUE = colors.HexColor("#EDF5FF")
PALE_CYAN = colors.HexColor("#EBFAFC")
PALE_GREEN = colors.HexColor("#ECF8F3")
PALE_ORANGE = colors.HexColor("#FFF4E9")
PALE_GREY = colors.HexColor("#F6F8FB")
WHITE = colors.white


def register_fonts() -> None:
    """Use bundled DejaVu fonts when available; Helvetica remains the fallback."""
    candidates = [
        Path("/System/Library/Fonts/Supplemental/Arial.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
    ]
    bold_candidates = [
        Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
    ]
    regular = next((path for path in candidates if path.exists()), None)
    bold = next((path for path in bold_candidates if path.exists()), None)
    if regular and bold:
        pdfmetrics.registerFont(TTFont("ProofSans", str(regular)))
        pdfmetrics.registerFont(TTFont("ProofSans-Bold", str(bold)))


register_fonts()
FONT = "ProofSans" if "ProofSans" in pdfmetrics.getRegisteredFontNames() else "Helvetica"
FONT_BOLD = "ProofSans-Bold" if "ProofSans-Bold" in pdfmetrics.getRegisteredFontNames() else "Helvetica-Bold"


BASE = getSampleStyleSheet()
STYLES = {
    "cover_label": ParagraphStyle(
        "cover_label",
        parent=BASE["Normal"],
        fontName=FONT_BOLD,
        fontSize=9,
        leading=11,
        textColor=BLUE,
        tracking=0.7,
        spaceAfter=10,
    ),
    "cover_title": ParagraphStyle(
        "cover_title",
        parent=BASE["Title"],
        fontName=FONT,
        fontSize=28,
        leading=32,
        textColor=INK,
        spaceAfter=12,
    ),
    "cover_subtitle": ParagraphStyle(
        "cover_subtitle",
        parent=BASE["Normal"],
        fontName=FONT,
        fontSize=12,
        leading=18,
        textColor=TEXT,
        spaceAfter=18,
    ),
    "section": ParagraphStyle(
        "section",
        parent=BASE["Normal"],
        fontName=FONT_BOLD,
        fontSize=8.5,
        leading=10,
        textColor=BLUE,
        tracking=0.6,
        spaceAfter=6,
    ),
    "h1": ParagraphStyle(
        "h1",
        parent=BASE["Heading1"],
        fontName=FONT,
        fontSize=22,
        leading=26,
        textColor=INK,
        spaceAfter=10,
    ),
    "h2": ParagraphStyle(
        "h2",
        parent=BASE["Heading2"],
        fontName=FONT_BOLD,
        fontSize=13,
        leading=16,
        textColor=INK,
        spaceBefore=8,
        spaceAfter=6,
    ),
    "h3": ParagraphStyle(
        "h3",
        parent=BASE["Heading3"],
        fontName=FONT_BOLD,
        fontSize=10,
        leading=13,
        textColor=INK,
        spaceBefore=5,
        spaceAfter=3,
    ),
    "body": ParagraphStyle(
        "body",
        parent=BASE["BodyText"],
        fontName=FONT,
        fontSize=9,
        leading=13,
        textColor=TEXT,
        spaceAfter=6,
    ),
    "body_small": ParagraphStyle(
        "body_small",
        parent=BASE["BodyText"],
        fontName=FONT,
        fontSize=7.6,
        leading=10.4,
        textColor=TEXT,
        spaceAfter=3,
    ),
    "table": ParagraphStyle(
        "table",
        parent=BASE["BodyText"],
        fontName=FONT,
        fontSize=7.15,
        leading=9.3,
        textColor=TEXT,
    ),
    "table_bold": ParagraphStyle(
        "table_bold",
        parent=BASE["BodyText"],
        fontName=FONT_BOLD,
        fontSize=7.2,
        leading=9.4,
        textColor=INK,
    ),
    "table_head": ParagraphStyle(
        "table_head",
        parent=BASE["BodyText"],
        fontName=FONT_BOLD,
        fontSize=7.2,
        leading=9.2,
        textColor=WHITE,
    ),
    "caption": ParagraphStyle(
        "caption",
        parent=BASE["BodyText"],
        fontName=FONT,
        fontSize=7,
        leading=9,
        textColor=MUTED,
        spaceAfter=4,
    ),
    "callout_title": ParagraphStyle(
        "callout_title",
        parent=BASE["BodyText"],
        fontName=FONT_BOLD,
        fontSize=9.2,
        leading=12,
        textColor=INK,
    ),
    "callout_body": ParagraphStyle(
        "callout_body",
        parent=BASE["BodyText"],
        fontName=FONT,
        fontSize=8.3,
        leading=11.4,
        textColor=TEXT,
    ),
    "code": ParagraphStyle(
        "code",
        parent=BASE["Code"],
        fontName="Courier",
        fontSize=6.7,
        leading=8.6,
        textColor=colors.HexColor("#E8EEF7"),
        leftIndent=0,
        rightIndent=0,
    ),
    "code_small": ParagraphStyle(
        "code_small",
        parent=BASE["Code"],
        fontName="Courier",
        fontSize=5.45,
        leading=7.0,
        textColor=colors.HexColor("#E8EEF7"),
        leftIndent=0,
        rightIndent=0,
    ),
    "reference": ParagraphStyle(
        "reference",
        parent=BASE["BodyText"],
        fontName=FONT,
        fontSize=7.15,
        leading=9.5,
        textColor=TEXT,
        spaceAfter=4,
    ),
}


def p(text: str, style: str = "body") -> Paragraph:
    return Paragraph(text, STYLES[style])


def cell(text: str, bold: bool = False) -> Paragraph:
    return p(text, "table_bold" if bold else "table")


def header_cell(text: str) -> Paragraph:
    return p(text, "table_head")


def section(label: str, title: str, intro: str | None = None) -> list[Flowable]:
    items: list[Flowable] = [p(label.upper(), "section"), p(title, "h1")]
    if intro:
        items.append(p(intro, "body"))
    return items


def callout(title: str, body: str, tone: str = "blue") -> Table:
    palette = {
        "blue": (BLUE, PALE_BLUE),
        "green": (GREEN, PALE_GREEN),
        "orange": (ORANGE, PALE_ORANGE),
        "cyan": (CYAN, PALE_CYAN),
        "grey": (MUTED, PALE_GREY),
    }
    accent, fill = palette[tone]
    table = Table(
        [[p(title, "callout_title"), p(body, "callout_body")]],
        colWidths=[48 * mm, BODY_W - 48 * mm],
        hAlign="LEFT",
    )
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), fill),
                ("LINEBEFORE", (0, 0), (0, -1), 3, accent),
                ("BOX", (0, 0), (-1, -1), 0.5, accent),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 9),
                ("RIGHTPADDING", (0, 0), (-1, -1), 9),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )
    return table


def cards(items: list[tuple[str, str, str]]) -> Table:
    palette = {
        "blue": (BLUE, PALE_BLUE),
        "green": (GREEN, PALE_GREEN),
        "orange": (ORANGE, PALE_ORANGE),
        "cyan": (CYAN, PALE_CYAN),
    }
    data = []
    row = []
    for title, body, tone in items:
        accent, fill = palette[tone]
        inner = Table(
            [[p(title, "callout_title")], [p(body, "callout_body")]],
            colWidths=[BODY_W / len(items) - 6],
        )
        inner.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, -1), fill),
                    ("LINEABOVE", (0, 0), (-1, 0), 3, accent),
                    ("BOX", (0, 0), (-1, -1), 0.5, LINE),
                    ("LEFTPADDING", (0, 0), (-1, -1), 8),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                    ("TOPPADDING", (0, 0), (-1, -1), 7),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ]
            )
        )
        row.append(inner)
    data.append(row)
    outer = Table(data, colWidths=[BODY_W / len(items)] * len(items), hAlign="LEFT")
    outer.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 3), ("RIGHTPADDING", (0, 0), (-1, -1), 3)]))
    return outer


def standard_table(
    headers: list[str],
    rows: list[list[str | Flowable]],
    widths: list[float],
    font_size: float = 7.15,
    repeat_rows: int = 1,
) -> Table:
    del font_size
    data: list[list[Flowable]] = [[header_cell(value) for value in headers]]
    for row in rows:
        converted: list[Flowable] = []
        for value in row:
            converted.append(value if isinstance(value, Flowable) else cell(value))
        data.append(converted)
    table = Table(data, colWidths=widths, repeatRows=repeat_rows, hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), NAVY),
                ("GRID", (0, 0), (-1, -1), 0.45, LINE),
                ("BACKGROUND", (0, 1), (-1, -1), WHITE),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, PALE_GREY]),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    return table


def code_block(text: str) -> Table:
    block = Preformatted(text.strip("\n"), STYLES["code"])
    table = Table([[block]], colWidths=[BODY_W], hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#14243B")),
                ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#203A5D")),
                ("LEFTPADDING", (0, 0), (-1, -1), 9),
                ("RIGHTPADDING", (0, 0), (-1, -1), 9),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )
    return table


def code_pair(left_title: str, left_text: str, right_title: str, right_text: str) -> Table:
    """Render two compact JSON examples side by side."""
    table = Table(
        [
            [p(left_title, "table_head"), p(right_title, "table_head")],
            [
                Preformatted(left_text.strip("\n"), STYLES["code_small"]),
                Preformatted(right_text.strip("\n"), STYLES["code_small"]),
            ],
        ],
        colWidths=[BODY_W / 2, BODY_W / 2],
        hAlign="LEFT",
    )
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#203A5D")),
                ("BACKGROUND", (0, 1), (-1, 1), colors.HexColor("#14243B")),
                ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#203A5D")),
                ("INNERGRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#38516F")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 7),
                ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    return table


def bullet_list(items: list[str], style: str = "body_small", gap: float = 0) -> list[Flowable]:
    result: list[Flowable] = []
    for index, item in enumerate(items):
        result.append(Paragraph(f"<bullet color='#1468D4'>&bull;</bullet>{item}", STYLES[style]))
        if gap and index < len(items) - 1:
            result.append(Spacer(1, gap))
    return result


class NumberedCircle(Flowable):
    def __init__(self, number: str, diameter: float = 22):
        super().__init__()
        self.number = number
        self.width = diameter
        self.height = diameter
        self.diameter = diameter

    def draw(self) -> None:
        self.canv.setFillColor(BLUE)
        self.canv.circle(self.diameter / 2, self.diameter / 2, self.diameter / 2, stroke=0, fill=1)
        self.canv.setFillColor(WHITE)
        self.canv.setFont(FONT_BOLD, 8)
        self.canv.drawCentredString(self.diameter / 2, self.diameter / 2 - 2.5, self.number)


class ProofDocTemplate(BaseDocTemplate):
    """Add navigable PDF outline entries for each numbered section."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._bookmark_counter = 0

    def afterFlowable(self, flowable: Flowable) -> None:
        if isinstance(flowable, Paragraph) and flowable.style.name == "h1":
            self._bookmark_counter += 1
            key = f"section-{self._bookmark_counter}"
            title = flowable.getPlainText()
            self.canv.bookmarkPage(key)
            self.canv.addOutlineEntry(title, key, level=0, closed=False)


def draw_cover(canvas: Canvas, doc: BaseDocTemplate) -> None:
    canvas.saveState()
    canvas.bookmarkPage("cover")
    canvas.addOutlineEntry("Cover", "cover", level=0, closed=False)
    canvas.setTitle("Hemas Enterprise WhatsApp API Technical Proof Pack")
    canvas.setAuthor("Safe Net Creations")
    canvas.setSubject("WhatsApp API technical feasibility, evidence and Enterprise scope")
    canvas.setFillColor(BLUE)
    canvas.rect(0, 0, 12 * mm, PAGE_H, stroke=0, fill=1)
    canvas.setFillColor(NAVY)
    canvas.setFont(FONT_BOLD, 9)
    canvas.drawString(LEFT, PAGE_H - 18 * mm, "SAFE NET CREATIONS")
    canvas.setFillColor(MUTED)
    canvas.setFont(FONT, 7.6)
    canvas.drawString(LEFT, PAGE_H - 23 * mm, "DIGITAL DEVELOPMENT & SYSTEMS STRATEGY")
    if HEMAS_LOGO.exists():
        canvas.drawImage(str(HEMAS_LOGO), PAGE_W - RIGHT - 43 * mm, PAGE_H - 31 * mm, 43 * mm, 21.6 * mm, mask="auto", preserveAspectRatio=True)
    canvas.setStrokeColor(LINE)
    canvas.line(LEFT, 15 * mm, PAGE_W - RIGHT, 15 * mm)
    canvas.setFillColor(MUTED)
    canvas.setFont(FONT, 7)
    canvas.drawString(LEFT, 10.5 * mm, "Safe Net Creations | Confidential technical response")
    canvas.drawRightString(PAGE_W - RIGHT, 10.5 * mm, "21 August 2026")
    canvas.restoreState()


def draw_body(canvas: Canvas, doc: BaseDocTemplate) -> None:
    canvas.saveState()
    canvas.setFillColor(BLUE)
    canvas.rect(0, 0, 6 * mm, PAGE_H, stroke=0, fill=1)
    canvas.setFillColor(MUTED)
    canvas.setFont(FONT, 6.8)
    canvas.drawRightString(PAGE_W - RIGHT - 2 * mm, 8.5 * mm, f"Page {doc.page}")
    canvas.restoreState()


def build_story() -> list[Flowable]:
    story: list[Flowable] = []

    # Cover
    story.extend(
        [
            Spacer(1, 31 * mm),
            p("ENTERPRISE TECHNICAL RESPONSE", "cover_label"),
            p("WhatsApp API Technical Feasibility & Evidence Pack", "cover_title"),
            p(
                "A precise response to the requested Bulk API, throughput, webhook, media, security, "
                "correlation and CTA requirements - with current evidence separated from proposed build "
                "scope and live acceptance.",
                "cover_subtitle",
            ),
            Spacer(1, 4 * mm),
        ]
    )
    meta = Table(
        [
            [p("PREPARED FOR", "table_bold"), p("Hemas Hospitals (Pvt) Ltd", "body")],
            [p("PREPARED BY", "table_bold"), p("Safe Net Creations", "body")],
            [p("TECHNICAL REFERENCE", "table_bold"), p("SNC-HEMAS-ENT-API-2026-R1", "body")],
            [p("DATE", "table_bold"), p("21 August 2026", "body")],
            [p("RELATED COMMERCIAL OFFER", "table_bold"), p("SNC-HEMAS-ENT-2026-Q2", "body")],
        ],
        colWidths=[49 * mm, BODY_W - 49 * mm],
    )
    meta.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.45, LINE),
                ("BACKGROUND", (0, 0), (0, -1), PALE_GREY),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    story.extend([meta, Spacer(1, 11 * mm)])
    story.append(
        cards(
            [
                ("TECHNICALLY FEASIBLE", "All requested outcomes can be delivered using Meta Cloud API plus an Enterprise integration layer.", "green"),
                ("ENTERPRISE SCOPE", "The customer-facing API, callbacks, load evidence and developer documentation are outside Lite.", "blue"),
                ("LIVE UAT REQUIRED", "Provider capacity, template approval and device delivery must be proven on Hemas-owned assets.", "orange"),
            ]
        )
    )
    story.extend(
        [
            Spacer(1, 9 * mm),
            callout(
                "Purpose of this pack",
                "This document is suitable for technical assessment. It includes official platform facts, proposed normalized contracts and dated local automated evidence. It deliberately does not label unbuilt or untested functions as live production proof.",
                "cyan",
            ),
            Spacer(1, 10 * mm),
            p("CONFIDENTIAL - TECHNICAL ASSESSMENT", "cover_label"),
            p(
                "No real patient data, live credentials, phone numbers or provider secrets appear in this document. All identifiers and payloads are synthetic examples.",
                "caption",
            ),
            NextPageTemplate("body"),
            PageBreak(),
        ]
    )

    # Page 2 - Executive position
    story.extend(
        section(
            "01 / Executive Position",
            "Feasible - with a clear Meta and Enterprise boundary",
            "Meta provides the underlying message, media and webhook capabilities. A secure Enterprise integration layer is required to deliver the customer-facing bulk contract, normalized callbacks, correlation, rate governance and proof package requested by Hemas.",
        )
    )
    story.append(
        callout(
            "Direct answer",
            "Yes, the requirements can be supported. No, they should not be represented as an already completed Hemas Connect Lite feature set. Contracted implementation belongs under Hemas Connect Enterprise and an explicit Technical Addendum/SOW.",
            "green",
        )
    )
    story.extend([Spacer(1, 6 * mm), p("How the solution divides responsibility", "h2")])
    story.append(
        cards(
            [
                ("META NATIVE", "One `to` destination per message request (individual or group), plus templates, media, webhooks, throughput and correlation.", "cyan"),
                ("ENTERPRISE LAYER", "Bulk job intake, validation, queueing, throttling, separate callback routing, normalization, bounded error-classified retry and documentation.", "blue"),
                ("HEMAS ACCEPTANCE", "Owned WABA/number, approved templates, test recipients, security decisions, volume profile, UAT and device evidence.", "orange"),
            ]
        )
    )
    story.extend([Spacer(1, 6 * mm), p("Evidence labels used throughout", "h2")])
    story.append(
        standard_table(
            ["LABEL", "MEANING", "WHAT IT DOES NOT MEAN"],
            [
                ["META DOCUMENTED", "Current behavior stated in official Meta documentation.", "Not proof that the current Hemas code implements it."],
                ["CURRENTLY EVIDENCED", "Dated local code/test evidence from the present repository baseline.", "Not a deployed provider or device result."],
                ["ENTERPRISE BUILD", "A defined component to implement under the Technical Addendum.", "Not included in Lite and not yet production accepted."],
                ["HEMAS UAT", "Evidence that must be captured using authorized Hemas-owned assets.", "Cannot be manufactured locally or inferred from documentation."],
            ],
            [34 * mm, 65 * mm, BODY_W - 99 * mm],
        )
    )
    story.extend(
        [
            Spacer(1, 6 * mm),
            callout(
                "Commercial boundary",
                "Quote SNC-HEMAS-LITE-2026-Q2 remains a one-number, three-seat, one-service managed pilot. Quote SNC-HEMAS-ENT-2026-Q2 is the Enterprise pathway. The exact API limits, callback contract, performance evidence and SLA must be fixed in an Enterprise Technical Addendum.",
                "orange",
            ),
            PageBreak(),
        ]
    )

    # Page 3 - Matrix
    story.extend(
        section(
            "02 / Capability Matrix",
            "Nine checkpoints, answered without overclaiming",
            "Support position reflects the requested business outcome. Evidence position identifies whether the answer comes from Meta, current code, planned Enterprise work or future UAT.",
        )
    )
    matrix_rows = [
        ["1", "Many-to-many / Bulk API", "FEASIBLE - BUILD + UAT REQUIRED", "Meta documents one `to` value per send. The proposed Enterprise gateway would accept a job and fan out queued sends. It is not a released customer Bulk API today. [M1, M2]"],
        ["2", "Batch size", "PROPOSED INTAKE - LOAD TEST REQUIRED", "The proposed job-intake maximum is 1,000 recipient items; this is not a Meta/provider batch limit. Final value follows load testing. Graph Batch is 50 logical subrequests, not WhatsApp bulk. [M3]"],
        ["3", "Requests per second", "META CAPACITY - CLIENT SLA NOT SET", "Meta documents 80 mps by default, eligible upgrade to 1,000 mps, and 20 mps for coexistence numbers. Client API RPS and dispatch MPS remain separate Addendum SLAs. [M4, M5]"],
        ["4", "DLR callback", "META NATIVE EVENT - ROUTER NOT YET BUILT", "Meta status events provide id, status, recipient_id and timestamp. A normalized signed Hemas callback requires the Enterprise router plus UAT. [M6]"],
        ["5", "Incoming reply callback", "META NATIVE EVENT - ROUTER NOT YET BUILT", "Meta inbound events provide id, from, text.body and timestamp. A separate normalized Hemas reply callback requires the Enterprise router plus UAT. [M7]"],
        ["6", "Media identifier / formats", "META FORMATS - CURRENT BUILD PARTIAL", "Meta documents media types, MIME formats and limits. Current local builders cover only a subset; every claimed type requires implementation and provider/device UAT. [M11, M12]"],
        ["7", "IP whitelisting", "META TLS/HMAC - POLICY TO AGREE", "Meta does not document mandatory source-IP allowlisting. TLS and raw-body HMAC validation are required; optional customer CIDR/mTLS policy belongs in the Addendum. [M8, M9]"],
        ["8", "Custom key in DLR", "META FIELD - MAPPING NOT YET UAT", "Do not add arbitrary unknown JSON keys. Map an opaque client_reference to supported biz_opaque_callback_data plus the internal ledger; status echo and rejection handling require UAT. [M1, M6]"],
        ["9", "Docs, CTA and dynamic URL", "META RULES - BUILD + UAT REQUIRED", "OpenAPI/Postman are proposed Addendum deliverables. Meta permits up to 2 template URL buttons, but current code has no live dynamic-URL template builder or send proof. [M13, M15]"],
    ]
    story.append(
        standard_table(
            ["#", "CHECKPOINT", "SUPPORT POSITION", "EVIDENCE / DELIVERY POSITION"],
            matrix_rows,
            [9 * mm, 43 * mm, 38 * mm, BODY_W - 90 * mm],
        )
    )
    story.extend(
        [
            Spacer(1, 5 * mm),
            callout(
                "Important terminology",
                "Meta throughput is measured in messages per second, not generic HTTP requests per second. A batch intake limit, gateway submission RPS and provider dispatch MPS must be stated separately in the final API SLA.",
                "blue",
            ),
            PageBreak(),
        ]
    )

    # Page 4 - Bulk and throughput
    story.extend(
        section(
            "03 / Bulk, Batch & Throughput",
            "Asynchronous fan-out is the safe bulk design",
            "There is no documented Meta recipient-array send for individualized campaigns. The correct design accepts a customer batch, validates it once, then dispatches one provider send per recipient under consent, quality and rate controls.",
        )
    )
    flow_data = [
        [cell("1. Hemas client", True), cell("2. Enterprise API", True), cell("3. Durable queue", True), cell("4. Meta messages", True)],
        [cell("Submit job + recipient items"), cell("Auth, schema, idempotency, consent"), cell("Pacing, bounded retry, pause, reconciliation"), cell("One `to` recipient per provider send")],
        [cell("7. Hemas callbacks", True), cell("6. Callback router", True), cell("5. Meta webhook", True), cell("Recipient device", True)],
        [cell("Signed DLR and inbound events"), cell("Normalize, dedupe, route"), cell("Statuses + incoming messages"), cell("Delivered/read/reply evidence")],
    ]
    flow = Table(flow_data, colWidths=[BODY_W / 4] * 4, hAlign="LEFT")
    flow.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), PALE_BLUE),
                ("BACKGROUND", (0, 2), (-1, 2), PALE_GREEN),
                ("GRID", (0, 0), (-1, -1), 0.55, LINE),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]
        )
    )
    story.append(flow)
    story.extend([Spacer(1, 6 * mm), p("Capacity facts and contract position", "h2")])
    story.append(
        standard_table(
            ["MEASURE", "CURRENT FACT", "CONTRACT POSITION"],
            [
                ["Meta native recipient count", "One `to` value in each message request.", "Enterprise fans out one recipient per Meta send."],
                ["Generic Graph batch", "Maximum 50 logical subrequests; each counts separately.", "Do not use as a throughput multiplier or call it native WhatsApp bulk."],
                ["Proposed Enterprise job", "Up to 1,000 recipient items per accepted asynchronous job.", "Provisional until queue and callback load tests pass."],
                ["Provider phone-number throughput", "80 mps default; eligible automatic upgrade to 1,000 mps; coexistence 20 mps.", "Runtime controller reads/uses the active capacity and preserves headroom for inbound traffic."],
                ["Same-recipient pair rate", "One message every 6 seconds to the same user; burst behavior borrows future quota.", "Prevent accidental repeated sends and do not equate account throughput with per-user throughput."],
                ["Campaign limits", "Messaging tier, consent, template approval, quality and policy still apply.", "Final capacity band is accepted during Hemas UAT; no unlimited commitment."],
            ],
            [45 * mm, 61 * mm, BODY_W - 106 * mm],
        )
    )
    story.extend(
        [
            Spacer(1, 5 * mm),
            callout(
                "Recommended initial SLA language",
                "The gateway accepts asynchronous jobs within the contracted intake rate and dispatches within active Meta capacity. Retries are bounded and error-classified; after an ambiguous provider outcome, reconcile the internal ledger and provider message ID before any resend. Exact sustained and burst figures follow the agreed load test.",
                "orange",
            ),
            PageBreak(),
        ]
    )

    # Page 5 - Webhooks
    story.extend(
        section(
            "04 / DLR & Incoming Webhooks",
            "The requested fields are available and can be normalized",
            "Meta uses one `messages` webhook field for incoming messages and outgoing statuses. The Enterprise router can deliver separate signed DLR and reply callbacks to pre-registered Hemas endpoints.",
        )
    )
    story.append(
        standard_table(
            ["CUSTOMER FIELD", "META NATIVE LOCATION", "NORMALIZATION"],
            [
                ["message_id", "Status: `statuses[].id`\nIncoming: `messages[].id`", "Expose as a stable top-level message_id."],
                ["status", "`statuses[].status`", "Pass documented values: sent, delivered, read, played or failed; preserve the raw event."],
                ["recipient_id (DLR)", "`statuses[].recipient_id`", "Outbound WhatsApp user target."],
                ["sender_id (reply)", "`messages[].from`", "Replying WhatsApp user; expose separately rather than silently changing its meaning."],
                ["recipient_id (reply)", "`metadata.phone_number_id`", "Provisional business destination identifier; Hemas must confirm whether it instead expects the sender alias."],
                ["text", "`messages[].text.body`", "Forward only under the approved privacy, retention and destination policy."],
                ["timestamp", "`statuses[].timestamp` or `messages[].timestamp`", "Default normalized format: UTC ISO-8601; native Unix value retained in raw evidence."],
                ["client_reference", "Send/status: `biz_opaque_callback_data`", "Expose only when Meta supplies it; always persist the request mapping in the internal ledger."],
            ],
            [39 * mm, 67 * mm, BODY_W - 106 * mm],
        )
    )
    story.extend([Spacer(1, 4 * mm), p("Provider correlation fragments", "h2")])
    story.append(
        p(
            "WhatsApp message payloads are schema-defined; do not rely on arbitrary unknown custom keys. Use supported `biz_opaque_callback_data` for the opaque reference and mirror it in the internal ledger. If Graph rejects the send synchronously before a wamid exists, there is no DLR; correlation comes from the request/job ledger and the synchronous error. [M1, M6]",
            "body_small",
        )
    )
    story.append(
        code_pair(
            "SANITIZED PROVIDER SEND FRAGMENT",
            """
{
 "to": "9477XXXXXXX",
 "type": "template",
 "biz_opaque_callback_data":
   "ref_demo_7f02c1",
 "template": {
  "name": "appointment_reminder_v1"
 }
}
""",
            "SANITIZED META STATUS FRAGMENT",
            """
{
 "statuses": [{
  "id": "wamid.DEMO_OUTBOUND_001",
  "status": "delivered",
  "recipient_id": "9477XXXXXXX",
  "timestamp": "1787307030",
  "biz_opaque_callback_data":
    "ref_demo_7f02c1"
 }]
}
""",
        )
    )
    story.extend([Spacer(1, 4 * mm), p("Provisional normalized DLR callbacks", "h2")])
    story.append(
        code_pair(
            "DELIVERED",
            """
{
 "event": "message.status",
 "message_id": "wamid.DEMO_OUTBOUND_001",
 "status": "delivered",
 "recipient_id": "9477XXXXXXX",
 "timestamp": "2026-08-21T10:20:30Z",
 "client_reference": "ref_demo_7f02c1"
}
""",
            "FAILED",
            """
{
 "event": "message.status",
 "message_id": "wamid.DEMO_OUTBOUND_002",
 "status": "failed",
 "recipient_id": "9477XXXXXXX",
 "timestamp": "2026-08-21T10:20:31Z",
 "client_reference": "ref_demo_7f02c2",
 "provider_errors": [{
  "code": 131026,
  "title": "Message undeliverable"
 }]
}
""",
        )
    )
    story.append(PageBreak())

    # Page 6 - Callback sample and operations
    story.extend(
        section(
            "04A / Callback Sample & Operations",
            "Provisional reply contract and reliable event handling",
            "The normalized reply schema below is proposed for the Technical Addendum. Field semantics, privacy handling, destination ownership and retry policy must be fixed before implementation.",
        )
    )
    story.append(p("Provisional normalized incoming reply callback", "h2"))
    story.append(
        code_block(
            """
{
  "event": "message.received",
  "message_id": "wamid.DEMO_INBOUND_001",
  "sender_id": "9477XXXXXXX",
  "recipient_id": "PHONE_NUMBER_ID_DEMO",
  "message_type": "text",
  "text": "Please send appointment information",
  "timestamp": "2026-08-21T10:21:04Z"
}
"""
        )
    )
    story.extend(
        [
            Spacer(1, 4 * mm),
            callout(
                "Field naming decision",
                "This sample uses sender_id for the replying WhatsApp user and recipient_id for the Hemas business phone-number ID. If Hemas intends recipient_id to mean the replying user, the Addendum can define an alias; it must not remain ambiguous.",
                "orange",
            ),
            Spacer(1, 5 * mm),
            p("Event-processing rules", "h2"),
            standard_table(
                ["EVENT / CONTROL", "PROPOSED ENTERPRISE BEHAVIOR"],
                [
                    ["Provider status", "Iterate all entry/change/status arrays; preserve raw id, status, recipient, timestamp, error and correlation fields."],
                    ["Incoming reply", "Iterate every message, identify type, minimize clinical content, and route only to a pre-registered authorized destination."],
                    ["Duplicate / ordering", "Use stable event identities, retain repeated and out-of-order observations, and derive current state without downgrading delivered/read."],
                    ["Synchronous rejection", "No wamid means no future DLR. Record the Graph error against the internal job/item ledger and expose item failure there."],
                    ["Customer callback", "Sign the exact payload, include event ID and timestamp, use bounded delivery retries, and expose dead-letter/replay operations."],
                ],
                [48 * mm, BODY_W - 48 * mm],
            ),
            Spacer(1, 5 * mm),
            callout(
                "Webhook security and reliability",
                "Use public HTTPS with a valid certificate, verify Meta X-Hub-Signature-256 over the raw body, iterate batched arrays, deduplicate repeated/out-of-order events and acknowledge promptly. Meta may aggregate up to 1,000 updates in a payload up to 3 MB and retry failed delivery for up to 7 days. Customer callbacks add HMAC, event ID, timestamp, bounded retry and dead-letter visibility. [M8, M9]",
                "blue",
            ),
            PageBreak(),
        ]
    )

    # Page 7 - Proposed API
    story.extend(
        section(
            "05 / Proposed Enterprise API Contract",
            "A secure job contract with item-level traceability",
            "This is a proposed contract for the Technical Addendum. It is not a claim that a public production endpoint is already released.",
        )
    )
    story.append(p("Bulk submission - proposed", "h2"))
    story.append(
        code_block(
            """
POST /v1/whatsapp/bulk-jobs
Authorization: Bearer <tenant-token>
Idempotency-Key: idem_demo_20260821_001

{
  "client_batch_id": "batch_demo_20260821_001",
  "callback_profile_id": "hemas-uat-default",
  "message": {
    "type": "template",
    "template_name": "appointment_reminder_v1",
    "language": "en"
  },
  "recipients": [
    {
      "recipient_id": "9477XXXXXXX",
      "client_reference": "ref_demo_7f02c1",
      "parameters": ["26 August 2026", "10:30"]
    }
  ]
}
"""
        )
    )
    story.extend([Spacer(1, 4 * mm), p("Asynchronous acceptance response - proposed", "h2")])
    story.append(
        code_block(
            """
HTTP/1.1 202 Accepted
{
  "job_id": "job_demo_01K35T6Y",
  "client_batch_id": "batch_demo_20260821_001",
  "status": "accepted",
  "accepted_items": 1,
  "rejected_items": 0,
  "submitted_at": "2026-08-21T10:19:55Z"
}
"""
        )
    )
    story.extend([Spacer(1, 5 * mm), p("Required contract controls", "h2")])
    controls = [
        ["Authentication", "Tenant-bound OAuth/API credential; optional CIDR/mTLS policy."],
        ["Idempotency", "Required key on all bulk mutations; identical replay returns the original job result."],
        ["Callback destinations", "Pre-registered and verified profiles, not arbitrary per-request URLs."],
        ["Correlation", "Opaque client_reference only; map to supported biz_opaque_callback_data and retain a request-to-wamid ledger."],
        ["Validation", "Schema, recipient format, provider-approved/allowlisted template, parameter count, consent/suppression and job-size checks."],
        ["Lifecycle", "accepted -> queued -> sent -> delivered/read or failed, with item-level evidence."],
        ["Reliability", "Rate control, bounded error-classified retry, dedupe, pause, reconciliation and dead-letter handling. Never blindly resend after an ambiguous provider outcome."],
        ["Documentation", "OpenAPI 3.1, Postman, JSON Schemas, error catalogue, webhook signing and retry rules."],
        ["Healthcare data", "Use opaque correlation only; never encode patient names, diagnoses, appointments, report values or other clinical information in provider-visible metadata."],
    ]
    story.append(standard_table(["CONTROL", "PROPOSED REQUIREMENT"], controls, [42 * mm, BODY_W - 42 * mm]))
    story.append(PageBreak())

    # Page 8 - Media/buttons/security
    story.extend(
        section(
            "06 / Media, CTA & Security",
            "Platform capability is broad; implementation proof is type-specific",
            "Meta documents the following format limits. Each type ultimately claimed by the solution must also pass schema, storage, malware/privacy and real-device acceptance tests.",
        )
    )
    story.append(
        standard_table(
            ["MEDIUM", "SUPPORTED FORMATS", "MAXIMUM / KEY CONDITION"],
            [
                ["Image", "JPEG, PNG", "5 MB; 8-bit RGB/RGBA."],
                ["Video", "MP4, .3gp (video/3gpp)", "16 MB; H.264 video and AAC audio; one or no audio stream."],
                ["Audio", "AAC, AMR, MP3/MPEG, MP4/M4A, OGG/Opus", "16 MB; OGG must use Opus and mono input."],
                ["Document", "TXT, PDF, XLS/XLSX, DOC/DOCX, PPT/PPTX", "100 MB; MIME type must match the file."],
                ["Sticker", "WebP", "100 KB static; 500 KB animated."],
                ["Other message types", "Text, location, contacts, templates, interactive, reactions, Flows", "Availability depends on message type, service window, account and template approval."],
            ],
            [30 * mm, 77 * mm, BODY_W - 107 * mm],
        )
    )
    story.extend([Spacer(1, 5 * mm), p("Buttons and dynamic URLs", "h2")])
    story.append(
        standard_table(
            ["TYPE", "CURRENT META RULE", "SEND-TIME BEHAVIOR"],
            [
                ["Template buttons", "Up to 10 total; up to 10 quick replies; up to 2 URL; up to 1 phone number.", "Final combination remains subject to template validation and client compatibility."],
                ["Interactive reply buttons", "Up to 3 predefined replies inside the service window.", "Button IDs/titles are passed in the interactive message."],
                ["Static template URL", "Complete URL is stored in the approved template.", "No dynamic URL value is passed during send."],
                ["Dynamic template URL", "Approved template stores the complete base URL plus one trailing placeholder.", "Each send passes only the trailing runtime variable; percent-encode it when it contains special characters."],
                ["Interactive CTA URL", "Separate service-window CTA message with a runtime URL.", "Pass the complete destination URL in the interactive action."],
            ],
            [41 * mm, 76 * mm, BODY_W - 117 * mm],
        )
    )
    story.extend(
        [
            Spacer(1, 4 * mm),
            callout(
                "Implementation evidence boundary",
                "These are current Meta platform rules, not proof of current Hemas implementation. The present repository has no live dynamic-URL template builder, approved dynamic template send or provider/device CTA result; those remain Enterprise build and UAT items.",
                "orange",
            ),
            Spacer(1, 4 * mm),
            p("IP and endpoint security", "h2"),
        ]
    )
    story.append(
        cards(
            [
                ("META INGRESS", "Valid TLS, raw-body HMAC and replay/dedupe controls. Meta does not document mandatory source-IP allowlisting; its published ranges change and mTLS can avoid static-list maintenance.", "blue"),
                ("CUSTOMER API", "OAuth/API credentials, tenant isolation, WAF/rate limits, audit trails and optional CIDR or mTLS policy.", "green"),
                ("CUSTOMER CALLBACKS", "Verified destinations, HMAC signatures, event IDs, timestamps, bounded retry, dead-letter reporting and secret rotation.", "orange"),
            ]
        )
    )
    story.extend([Spacer(1, 4 * mm), p("Official media and button sources: [M11] to [M15].", "caption"), PageBreak()])

    # Page 8 - Current evidence
    story.extend(
        section(
            "07 / Current Evidence Snapshot",
            "What the present repository proves today",
            "Evidence below was refreshed locally on 21 August 2026 against source revision dff1a27d069f92c54f7d7aa26d21c97ffdc5e7eb. It is code and automated-test evidence, not a current deployed Meta acceptance result.",
        )
    )
    story.append(
        callout(
            "Automated result",
            "The local Functions TypeScript build command exited successfully. Six focused suites covering campaign planning, synthetic ingress, Lite campaign state, Meta canary contracts, bot payload builders and the internal template schema passed 64 of 64 tests with zero failures. The exact command manifest is on the next page. Tests ran on Node.js 20.20.2; repeat under declared Node.js 22 before certification.",
            "green",
        )
    )
    story.extend([Spacer(1, 5 * mm), p("Currently evidenced", "h2")])
    story.extend(
        bullet_list(
            [
                "Exact verify-token challenge handling and raw-body HMAC signature verification.",
                "Allowlist normalization, deduplication and five-tester canary cap.",
                "Content-minimized inbound extraction and strict template-name/language validation.",
                "Synthetic Enterprise ingress tests prove duplicate/replay idempotency, STOP suppression and atomic failure behavior.",
                "Synthetic Enterprise ingress tests prove preservation of out-of-order statuses and monotonic current-state projection.",
                "Canonical 50,000-contact synthetic audience planning in bounded 1,000-item batches, ending with an exact 443-item final batch.",
                "Lite campaign contract and status-ordering tests.",
                "Interactive reply-button and image-by-media-ID payload builders, plus strictly validated/allowlisted template payloads and the internal governed template schema.",
            ],
            "body",
            1.4,
        )
    )
    story.extend([Spacer(1, 3 * mm), p("Current controlled boundary", "h2")])
    story.append(
        standard_table(
            ["AREA", "CURRENT STATE", "PROOF LIMIT"],
            [
                ["Bulk sending", "Internal recipients array; maximum five allowlisted testers; sequential provider fan-out.", "Not a released customer Bulk API and not live scale proof."],
                ["Message types", "Local builders cover text, validated/allowlisted template payloads, interactive buttons/lists and image by Meta media ID.", "Provider template approval, dynamic URL sends, audio, video and document send proof are not presently complete."],
                ["Status ingestion", "Local helpers/tests cover signed receipt, wamid/status parsing and no-downgrade logic; synthetic ingress fixtures cover ordered projection.", "No deployed provider result or tenant-configurable external DLR callback yet."],
                ["Incoming messages", "Local parsing/tests cover signed inbound handling and privacy-minimized diagnostics using synthetic fixtures.", "No approved external plaintext reply-forwarding contract or live reply proof yet."],
                ["Performance", "Synthetic audience planning is bounded and deterministic.", "No production RPS controller or dated provider load benchmark."],
            ],
            [36 * mm, 78 * mm, BODY_W - 114 * mm],
        )
    )
    story.extend(
        [
            Spacer(1, 5 * mm),
            callout(
                "Not yet proven",
                "No current live provider/device evidence is included for an Enterprise bulk endpoint, 1,000-item production jobs, separate customer callbacks, custom-reference recovery, full media coverage, approved dynamic CTA templates or contracted RPS. These are acceptance items, not assumptions.",
                "orange",
            ),
            PageBreak(),
        ]
    )

    # Page 9 - Evidence manifest
    story.extend(
        section(
            "08 / Local Evidence Manifest",
            "Exact reproducible commands and results",
            "This manifest records the local review run completed on 21 August 2026 at 20:55 +0530. It preserves the command/result boundary supporting the 64-of-64 statement; it is not Meta, device or production acceptance evidence.",
        )
    )
    story.append(
        callout(
            "Run identity",
            "Source revision dff1a27d069f92c54f7d7aa26d21c97ffdc5e7eb | local runtime Node.js v20.20.2 | declared Functions runtime Node.js 22 | synthetic fixtures | no live Meta, callback endpoint or device calls.",
            "cyan",
        )
    )
    story.extend([Spacer(1, 5 * mm), p("Build and focused suites", "h2")])
    evidence_rows = [
        ["Functions build", "npm --prefix functions run build", "EXIT 0"],
        ["Meta canary", "node --test<br/>functions/lib/test/meta-canary.test.js", "6 / 6"],
        ["Lite contracts", "node --test<br/>functions/lib/test/lite.test.js", "10 / 10"],
        ["Synthetic ingress", "node --test<br/>functions/lib/test/ingress-pipeline.test.js", "19 / 19"],
        ["Audience planning", "node --test<br/>functions/lib/test/campaigns-audience.test.js", "4 / 4"],
        ["Bot payload builders", "./node_modules/.bin/tsx --test<br/>functions/test/meta-bot.test.ts", "16 / 16"],
        ["Template repository", "./node_modules/.bin/vitest run --config vitest.config.ts<br/>tests/template-repository.test.ts", "9 / 9"],
    ]
    story.append(
        standard_table(
            ["STEP", "EXACT COMMAND", "RESULT"],
            evidence_rows,
            [42 * mm, BODY_W - 68 * mm, 26 * mm],
        )
    )
    story.extend(
        [
            Spacer(1, 5 * mm),
            callout(
                "Focused automated total",
                "64 / 64 tests passed; 0 failed. The four compiled JavaScript suites ran after the successful TypeScript build. The TypeScript bot suite and Vitest repository suite ran through the repository-pinned local tools.",
                "green",
            ),
            Spacer(1, 5 * mm),
            p("Interpretation limits", "h2"),
        ]
    )
    story.extend(
        bullet_list(
            [
                "These commands exercise local code and synthetic fixtures only; they do not send WhatsApp messages or establish customer callback delivery.",
                "A successful build and unit-test run does not prove throughput, Meta account eligibility, template approval, handset delivery/read, reply routing or Enterprise SLA compliance.",
                "Certification requires repeating the build/tests under Node.js 22 and completing the live Hemas UAT matrix on authorized Hemas-owned assets.",
            ],
            "body",
            2,
        )
    )
    story.append(PageBreak())

    # Page 10 - Delivery and UAT
    story.extend(
        section(
            "09 / Enterprise Delivery & Acceptance",
            "The proof sequence required before production sign-off",
            "A formal Technical Addendum should convert the proposed contracts in this pack into fixed deliverables, capacity bands, responsibilities and acceptance evidence.",
        )
    )
    phases = [
        ["1", "Discovery & contract", "Confirm volumes, message categories, endpoints, security, retention, WABA state, callback semantics and final SLOs."],
        ["2", "API & queue build", "Implement authenticated bulk jobs, item ledger, validation, consent checks, pacing, idempotency, pause/reconcile and error model."],
        ["3", "Callback delivery", "Implement registered destinations, normalized DLR/inbound schemas, HMAC, bounded retry, replay handling and dead-letter operations."],
        ["4", "Media, CTA & docs", "Complete agreed message types, OpenAPI 3.1, Postman, JSON Schemas, security guide and sample fixtures."],
        ["5", "Load & failure tests", "Measure intake RPS, dispatch MPS, queue latency, callback throughput, retries, duplicates, outages and recovery."],
        ["6", "Hemas UAT", "Capture provider acceptance, sent/delivered/read, inbound reply, custom key recovery, media/CTA results and redacted device evidence."],
    ]
    story.append(standard_table(["PHASE", "WORKSTREAM", "ACCEPTANCE OUTPUT"], phases, [16 * mm, 48 * mm, BODY_W - 64 * mm]))
    story.extend([Spacer(1, 6 * mm), p("Minimum live UAT evidence", "h2")])
    uat_left = bullet_list(
        [
            "Hemas-owned WABA, number and approved app/permissions.",
            "One approved utility template and authorized test recipients.",
            "Provider response with recorded wamid.",
            "Capture sent, delivered and read events by message ID and timestamps while tolerating duplicates and out-of-order delivery.",
            "One real incoming text reply received and normalized.",
        ]
    )
    uat_right = bullet_list(
        [
            "Exact opaque client_reference recovered in DLR.",
            "One image, document, video and CTA case for every type claimed.",
            "Duplicate/out-of-order callback and endpoint-outage evidence.",
            "Agreed job-size and sustained/burst load-test report.",
            "Redacted evidence matrix signed by named technical owners.",
        ]
    )
    uat_table = Table([[uat_left, uat_right]], colWidths=[BODY_W / 2, BODY_W / 2])
    uat_table.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("BOX", (0, 0), (-1, -1), 0.5, LINE), ("INNERGRID", (0, 0), (-1, -1), 0.5, LINE), ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8), ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7)]))
    story.append(uat_table)
    story.extend(
        [
            Spacer(1, 6 * mm),
            callout(
                "Commercial position",
                "This pack provides the feasibility response only. Building and accepting the custom Bulk API, customer callbacks, correlation, performance proof and developer package requires a separately authorized Enterprise Technical Addendum/SOW. This pack does not itself modify price or authorize production activation.",
                "blue",
            ),
            PageBreak(),
        ]
    )

    # Page 11 - References
    story.extend(
        section(
            "10 / Official References",
            "Primary sources used for this technical response",
            "Official Meta source pointers selected for this response are listed below. Documentation access, limits and eligibility may change; revalidate the active Graph version, authenticated target account and each contracted rule during implementation and UAT. These links are not provider acceptance evidence.",
        )
    )
    refs = [
        ("M1", "Message API", "https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-phone-number/message-api/"),
        ("M2", "Marketing Messages API", "https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-phone-number/marketing-messages-api-for-whatsapp/"),
        ("M3", "Graph API Batch Requests", "https://developers.facebook.com/docs/graph-api/batch-requests/"),
        ("M4", "WhatsApp Throughput", "https://developers.facebook.com/documentation/business-messaging/whatsapp/throughput/"),
        ("M5", "Pair Rate Limits", "https://developers.facebook.com/documentation/business-messaging/whatsapp/about-the-platform#pair-rate-limits"),
        ("M6", "Status Webhook Reference", "https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/status/"),
        ("M7", "Incoming Text Webhook Reference", "https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/text/"),
        ("M8", "Create Webhook Endpoint", "https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/create-webhook-endpoint/"),
        ("M9", "Webhook Overview and Security", "https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview/"),
        ("M10", "Webhook Callback Overrides", "https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/override/"),
        ("M11", "Send Messages", "https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages/"),
        ("M12", "Media Formats and Limits", "https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/media/"),
        ("M13", "Template Components and Buttons", "https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/components/"),
        ("M14", "Interactive Reply Buttons", "https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/interactive-reply-buttons-messages/"),
        ("M15", "Interactive CTA URL Messages", "https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/interactive-cta-url-messages/"),
    ]
    ref_rows: list[list[Flowable]] = []
    for ref_id, title, url in refs:
        linked = p(f"<link href='{url}' color='#1468D4'><b>{title}</b></link><br/><font size='6.4' color='#65758D'>{url}</font>", "reference")
        ref_rows.append([cell(ref_id, True), linked])
    story.append(standard_table(["REF", "OFFICIAL META SOURCE"], ref_rows, [14 * mm, BODY_W - 14 * mm]))
    story.append(PageBreak())

    # Page 12 - Client decisions
    story.extend(
        section(
            "11 / Client Decisions & Next Action",
            "Confirm scope before any production promise",
            "The following inputs convert this feasibility response into a fixed Enterprise Technical Addendum with accepted limits, responsibilities, test cases and price.",
        )
    )
    story.append(p("Decisions required from Hemas", "h2"))
    story.extend(
        bullet_list(
            [
                "Expected recipients per job, daily volume, peak campaign window and message categories.",
                "Required client submission RPS and provider-dispatch expectations.",
                "One callback URL or separate DLR and inbound destinations; authentication, IP/mTLS and retry expectations.",
                "Meaning of recipient_id for inbound replies and required timestamp format.",
                "Required media types, languages, CTA combinations and approved template ownership.",
                "WABA/number ownership, UAT recipients, data-retention policy and named technical/security approvers.",
                "Enterprise Core plus Addendum, or Enterprise Network programme and included connector boundary.",
            ],
            "body",
        )
    )
    story.extend(
        [
            Spacer(1, 4 * mm),
            p("Decision record for discovery", "h2"),
            standard_table(
                ["DECISION", "STATUS AT ISSUE", "TO BE CONFIRMED BY"],
                [
                    ["Commercial pathway", "Enterprise scope required", "Hemas business owner"],
                    ["Target assets", "WABA, number and Graph version not supplied", "Hemas Meta administrator"],
                    ["Volume and rate profile", "Not supplied", "Hemas technical/operations owner"],
                    ["Callback and security model", "Separate routing supported; exact policy open", "Hemas security/API owner"],
                    ["Media, CTA and languages", "Capability documented; acceptance set open", "Hemas product/content owner"],
                    ["UAT and sign-off", "Live evidence pending", "Named Hemas and Safe Net approvers"],
                ],
                [49 * mm, 65 * mm, BODY_W - 114 * mm],
            ),
            Spacer(1, 6 * mm),
            p("Commercial reference", "h2"),
            standard_table(
                ["OFFER", "CURRENT COMMERCIAL POSITION"],
                [
                    ["Lite - SNC-HEMAS-LITE-2026-Q2", "LKR 75,000 setup + LKR 65,000/month; three-month managed pilot."],
                    ["Enterprise Core - SNC-HEMAS-ENT-2026-Q2", "LKR 550,000 implementation + LKR 195,000/month; external integrations excluded."],
                    ["Enterprise Network - SNC-HEMAS-ENT-2026-Q2", "LKR 2.4 million implementation + LKR 325,000/month; twelve-month term and one standard REST/JSON connector."],
                ],
                [67 * mm, BODY_W - 67 * mm],
            ),
            Spacer(1, 4 * mm),
            callout(
                "Addendum boundary",
                "The custom bulk gateway, callback router, performance proof and developer package are not automatically the quoted standard connector. Their exact boundary and price require the Enterprise Technical Addendum.",
                "orange",
            ),
            Spacer(1, 5 * mm),
            callout(
                "Recommended next action",
                "Confirm that these checkpoints are required contractual deliverables, nominate the Hemas technical owner, and authorize a separately scoped and priced API discovery stage - or confirm its commercial treatment in the selected Enterprise SOW. Safe Net Creations will then issue the final Addendum with fixed limits, test plan, responsibilities and price.",
                "green",
            ),
        ]
    )

    return story


def main() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    doc = ProofDocTemplate(
        str(OUTPUT),
        pagesize=A4,
        leftMargin=LEFT,
        rightMargin=RIGHT,
        topMargin=TOP,
        bottomMargin=BOTTOM,
        title="Hemas Enterprise WhatsApp API Technical Proof Pack",
        author="Safe Net Creations",
        subject="WhatsApp API technical feasibility, evidence and Enterprise scope",
    )
    cover_frame = Frame(LEFT, BOTTOM, BODY_W, PAGE_H - TOP - BOTTOM, id="cover_frame", leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    body_frame = Frame(LEFT, BOTTOM, BODY_W, PAGE_H - TOP - BOTTOM, id="body_frame", leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    doc.addPageTemplates(
        [
            PageTemplate(id="cover", frames=[cover_frame], onPage=draw_cover),
            PageTemplate(id="body", frames=[body_frame], onPage=draw_body),
        ]
    )
    doc.build(build_story())
    print(OUTPUT)


if __name__ == "__main__":
    main()
