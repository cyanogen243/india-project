from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    KeepTogether,
    PageTemplate,
    Paragraph,
    Spacer,
)

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "offline-pack"
OUT.mkdir(parents=True, exist_ok=True)

INK = colors.HexColor("#132c2d")
RED = colors.HexColor("#9b2c2c")
PAPER = colors.HexColor("#f4f1e9")
LINE = colors.HexColor("#c9c0ae")


def find_hindi_font():
    candidates = [
        Path(r"C:\Windows\Fonts\Nirmala.ttc"),
        Path(r"C:\Windows\Fonts\mangal.ttf"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None


def footer(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(INK)
    canvas.setFont("Helvetica", 8)
    canvas.drawString(18 * mm, 12 * mm, "THE INDIA PROJECT · OFFLINE FIELD PACK")
    canvas.drawRightString(192 * mm, 12 * mm, f"{doc.page}")
    canvas.restoreState()


def build_pdf(path, language, title, intro, sections):
    font_name = "Helvetica"
    bold_name = "Helvetica-Bold"
    if language == "hi":
        hindi_font = find_hindi_font()
        if hindi_font:
            pdfmetrics.registerFont(
                TTFont("Nirmala", str(hindi_font), subfontIndex=0, shapable=True)
            )
            font_name = "Nirmala"
            bold_name = "Nirmala"

    doc = BaseDocTemplate(
        str(path),
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=20 * mm,
        bottomMargin=20 * mm,
        title=title,
        author="The India Project editorial team",
    )
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="body")
    doc.addPageTemplates([PageTemplate(id="main", frames=[frame], onPage=footer)])

    styles = getSampleStyleSheet()
    kicker = ParagraphStyle(
        "Kicker",
        parent=styles["Normal"],
        fontName=bold_name,
        fontSize=8,
        leading=11,
        textColor=RED,
        spaceAfter=5 * mm,
        tracking=1.2,
    )
    heading = ParagraphStyle(
        "Heading",
        parent=styles["Title"],
        fontName=bold_name,
        fontSize=26,
        leading=30,
        textColor=INK,
        alignment=TA_LEFT,
        spaceAfter=6 * mm,
    )
    intro_style = ParagraphStyle(
        "Intro",
        parent=styles["BodyText"],
        fontName=font_name,
        fontSize=12,
        leading=17,
        textColor=INK,
        backColor=PAPER,
        borderColor=LINE,
        borderWidth=0.5,
        borderPadding=8,
        spaceAfter=8 * mm,
    )
    section_style = ParagraphStyle(
        "Section",
        parent=styles["Heading2"],
        fontName=bold_name,
        fontSize=15,
        leading=19,
        textColor=INK,
        spaceAfter=2 * mm,
    )
    body_style = ParagraphStyle(
        "Body",
        parent=styles["BodyText"],
        fontName=font_name,
        fontSize=10.5,
        leading=15,
        textColor=INK,
        leftIndent=7 * mm,
        firstLineIndent=-7 * mm,
        bulletIndent=0,
        spaceAfter=2.2 * mm,
    )
    note_style = ParagraphStyle(
        "Note",
        parent=body_style,
        fontSize=9,
        leading=13,
        textColor=RED,
        leftIndent=0,
        firstLineIndent=0,
        spaceBefore=5 * mm,
    )

    story = [
        Paragraph("THE INDIA PROJECT · PUBLIC-INTEREST RESOURCE", kicker),
        Paragraph(title, heading),
        Paragraph(intro, intro_style),
    ]
    for index, (section_title, bullets) in enumerate(sections, start=1):
        block = [
            Paragraph(f"{index:02d} · {section_title}", section_style),
            *[
                Paragraph(f"•&nbsp;&nbsp;{bullet}", body_style)
                for bullet in bullets
            ],
            Spacer(1, 4 * mm),
        ]
        story.append(KeepTogether(block))
    stale_note = (
        "ऑफलाइन सामग्री पुरानी हो सकती है। उपयोग से पहले प्रकाशन और समाप्ति समय जाँचें।"
        if language == "hi"
        else "Offline material can become stale. Check publication and expiry times before relying on it."
    )
    story.append(Paragraph(stale_note, note_style))
    doc.build(story)


build_pdf(
    OUT / "field-pack-en.pdf",
    "en",
    "Field pack — English",
    "A short, offline checklist for safer information use and responsible documentation. This is general preparation information, not legal or medical advice.",
    [
        (
            "Before leaving",
            [
                "Tell a trusted person your plan and expected check-in time.",
                "Carry essential medication, water, a charged power bank, and emergency details on paper.",
                "Consider the privacy risks of unlock methods, cloud backups, and location sharing.",
            ],
        ),
        (
            "Verify before sharing",
            [
                "Check the event time, publication time, expiry time, and source tier.",
                "Do not treat a forwarded message, viral post, or anonymous report as verified on its own.",
                "Look for a visible correction or retraction record.",
            ],
        ),
        (
            "Document responsibly",
            [
                "Preserve the original separately and work only on a redacted public copy.",
                "Do not publish faces, number plates, medical details, or names without review and consent.",
                "Record a broad zone only; never publish live positions of protesters, police, medics, or shelters.",
            ],
        ),
        (
            "If conditions change",
            [
                "Prioritise personal safety and follow locally verified emergency guidance.",
                "Do not use this site to coordinate crowd movement or report exact positions.",
                "Reconnect when safe and confirm that cached information is still current.",
            ],
        ),
    ],
)

build_pdf(
    OUT / "field-pack-hi.pdf",
    "hi",
    "फील्ड पैक — हिंदी",
    "सुरक्षित सूचना उपयोग और जिम्मेदार दस्तावेज़ीकरण के लिए एक छोटा ऑफलाइन जाँच-पत्र। यह सामान्य तैयारी सूचना है, कानूनी या चिकित्सकीय सलाह नहीं।",
    [
        (
            "जाने से पहले",
            [
                "किसी विश्वसनीय व्यक्ति को अपनी योजना और जाँच का अपेक्षित समय बताएँ।",
                "आवश्यक दवाएँ, पानी, चार्ज किया हुआ पावर बैंक और कागज़ पर आपात विवरण रखें।",
                "फ़ोन अनलॉक, क्लाउड बैकअप और स्थान साझा करने के निजता जोखिम पर विचार करें।",
            ],
        ),
        (
            "साझा करने से पहले सत्यापित करें",
            [
                "घटना समय, प्रकाशन समय, समाप्ति समय और स्रोत स्तर जाँचें।",
                "फॉरवर्ड संदेश, वायरल पोस्ट या गुमनाम रिपोर्ट को अकेले सत्यापित न मानें।",
                "दिखाई देने वाला सुधार या वापसी रिकॉर्ड देखें।",
            ],
        ),
        (
            "जिम्मेदारी से दस्तावेज़ बनाएँ",
            [
                "मूल फ़ाइल अलग सुरक्षित रखें और केवल पहचान-मुक्त सार्वजनिक प्रति पर काम करें।",
                "समीक्षा और सहमति के बिना चेहरे, नंबर प्लेट, चिकित्सा विवरण या नाम प्रकाशित न करें।",
                "केवल व्यापक क्षेत्र दर्ज करें; प्रदर्शनकारियों, पुलिस, चिकित्सकों या आश्रय का लाइव स्थान कभी प्रकाशित न करें।",
            ],
        ),
        (
            "यदि स्थिति बदलती है",
            [
                "व्यक्तिगत सुरक्षा को प्राथमिकता दें और स्थानीय रूप से सत्यापित आपात मार्गदर्शन का पालन करें।",
                "इस साइट का उपयोग भीड़ की चाल समन्वित करने या सटीक स्थान बताने के लिए न करें।",
                "सुरक्षित होने पर फिर जुड़ें और जाँचें कि कैश की गई सूचना अभी भी वर्तमान है।",
            ],
        ),
    ],
)

print(f"Created offline packs in {OUT}")
