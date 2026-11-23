"""The quotation as a PDF, on the Tofaa India letterhead (red top bar, logo and rule above; contact details,
address, GSTIN and the 'powered by' band below, on every page). Core PDF fonts only, so text is kept to what
Latin-1 can show (the rupee sign is written 'Rs.')."""
import logging
from datetime import date
from io import BytesIO
from pathlib import Path

from fpdf import FPDF
from fpdf.enums import XPos, YPos

from src.core.config import settings
from src.core.money import format_inr

ACCENT = (187, 18, 23)       # #BB1217, the letterhead red
INK = (42, 42, 42)           # #2a2a2a
RULE = (217, 217, 217)       # #d9d9d9
GREY = (100, 116, 139)
PHOTO_MM = 40                # mockup thumbnails: four to a row
LOGO = Path(__file__).parent / "assets" / "logo.png"
log = logging.getLogger(__name__)

# The letterhead is drawn at 794 x 1123 px; A4 is 210 x 297 mm.
PX = 210 / 794
SIDE = 64 * PX               # header and footer inset
BODY_SIDE = 72 * PX          # letter body inset
BODY_TOP = (6 + 44 + 60 + 26 + 2 + 40) * PX
FOOTER_H = (2 + 20 + 62 + 22 + 40) * PX
BODY_BOTTOM = FOOTER_H + 32 * PX


def _icon(name: str) -> bytes:
    """The letterhead's line icons, in the accent colour."""
    paths = {
        "phone": '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
        "mail": '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
        "globe": '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
        "pin": '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
        "file": '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M8 13h8"/><path d="M8 17h5"/>',
    }
    colour = "#%02X%02X%02X" % ACCENT
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="{colour}" '
        f'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">{paths[name]}</svg>'
    ).encode()


def _address_lines() -> list[str]:
    raw = settings.COMPANY_ADDRESS or "601 B-Wing Amar Business Zone,\nBaner, Pune, Maharashtra 411045"
    return [x.strip() for x in raw.replace("\\n", "\n").split("\n") if x.strip()]


class Letterhead(FPDF):
    """An A4 page with the letterhead drawn on it. The body sits between the header rule and the footer."""

    def __init__(self) -> None:
        super().__init__(format="A4")
        self.set_margins(BODY_SIDE, BODY_TOP, BODY_SIDE)
        self.set_auto_page_break(True, BODY_BOTTOM)

    def _draw_icon(self, name: str, x: float, y: float) -> None:
        try:
            self.image(BytesIO(_icon(name)), x=x, y=y, w=14 * PX, h=14 * PX)
        except Exception:  # noqa: BLE001 - an icon must never stop the quotation
            log.warning("could not draw the %s icon", name, exc_info=True)

    def header(self) -> None:
        self.set_fill_color(*ACCENT)
        self.rect(0, 0, self.w, 6 * PX, "F")
        logo_y = (6 + 44) * PX
        if LOGO.exists():
            self.image(str(LOGO), x=SIDE, y=logo_y, h=60 * PX)
        else:  # no logo file: the company name in its place
            self.set_xy(SIDE, logo_y)
            self.set_font("Helvetica", "B", 22)
            self.set_text_color(*ACCENT)
            self.cell(0, 60 * PX, _t(settings.COMPANY_NAME))
        rule_y = (6 + 44 + 60 + 26) * PX
        self._rule(rule_y, accent_first=True)
        self.set_xy(self.l_margin, self.t_margin)

    def _rule(self, y: float, *, accent_first: bool) -> None:
        """A short accent bar joined to a thin grey line, as in the letterhead."""
        accent_w, left, right = 64 * PX, SIDE, self.w - SIDE
        ax = left if accent_first else right - accent_w
        gx0, gx1 = (left + accent_w, right) if accent_first else (left, right - accent_w)
        self.set_fill_color(*RULE)
        self.rect(gx0, y + 0.5 * PX, gx1 - gx0, 1 * PX, "F")
        self.set_fill_color(*ACCENT)
        self.rect(ax, y, accent_w, 2 * PX, "F")

    def footer(self) -> None:
        top = self.h - FOOTER_H
        self._rule(top, accent_first=False)
        icon, gap, line = 14 * PX, 9 * PX, 15 * PX
        y0 = top + (2 + 20) * PX

        self.set_font("Helvetica", "", 9)
        self.set_text_color(*INK)

        # left: phone, email, website (each a link)
        rows = [
            ("phone", settings.COMPANY_PHONE, f"tel:{settings.COMPANY_PHONE.replace(' ', '')}"),
            ("mail", settings.COMPANY_EMAIL, f"mailto:{settings.COMPANY_EMAIL}"),
            ("globe", settings.COMPANY_WEBSITE, f"https://{settings.COMPANY_WEBSITE.removeprefix('https://').removeprefix('http://')}"),
        ]
        rows = [r for r in rows if r[1]]
        left_w = icon + gap + max((self.get_string_width(_t(r[1])) for r in rows), default=0)
        y = y0
        for name, text, link in rows:
            self._draw_icon(name, SIDE, y + (line - icon) / 2)
            self.set_xy(SIDE + icon + gap, y)
            self.cell(0, line, _t(text), link=link)
            y += line + 7 * PX

        # right: address and GSTIN, right-aligned as a block
        address = _address_lines()
        gst_label, gstin = "GSTIN ", settings.COMPANY_GSTIN
        self.set_font("Helvetica", "B", 9)
        gst_w = self.get_string_width(gstin)
        self.set_font("Helvetica", "", 9)
        text_w = max([self.get_string_width(_t(a)) for a in address] + [self.get_string_width(gst_label) + gst_w])
        right_x = self.w - SIDE - (icon + gap + text_w)
        y = y0
        if address:
            self._draw_icon("pin", right_x, y + 2 * PX)
            for a in address:
                self.set_xy(right_x + icon + gap, y)
                self.cell(0, 18.75 * PX, _t(a))
                y += 18.75 * PX
            y += 9 * PX
        if gstin:
            self._draw_icon("file", right_x, y + (line - icon) / 2)
            self.set_xy(right_x + icon + gap, y)
            self.cell(self.get_string_width(gst_label), line, gst_label)
            self.set_font("Helvetica", "B", 9)
            self.cell(0, line, _t(gstin))

        # the divider halfway between the two columns
        mid = (SIDE + left_w + right_x) / 2
        self.set_fill_color(*RULE)
        self.rect(mid, y0, 1 * PX, 62 * PX, "F")

        # bottom band
        band_h = 40 * PX
        band_y = self.h - band_h
        self.set_fill_color(*ACCENT)
        self.rect(0, band_y, self.w, band_h, "F")
        self.set_text_color(255, 255, 255)
        lead_text, brand = f"{_t(settings.COMPANY_NAME)} powered by ", _t(settings.COMPANY_POWERED_BY)
        self.set_font("Helvetica", "", 8.5)
        self.set_char_spacing(0.15)
        lead_w = self.get_string_width(lead_text)
        self.set_font("Helvetica", "B", 8.5)
        self.set_char_spacing(0.5)
        brand_w = self.get_string_width(brand) if brand else 0
        x = (self.w - lead_w - brand_w) / 2
        self.set_xy(x, band_y)
        self.set_font("Helvetica", "", 8.5)
        self.set_char_spacing(0.15)
        self.cell(lead_w if brand else 0, band_h, lead_text.strip() if not brand else lead_text, align="L" if brand else "C")
        if brand:
            self.set_font("Helvetica", "B", 8.5)
            self.set_char_spacing(0.5)
            self.cell(brand_w, band_h, brand)
        self.set_char_spacing(0)


def _t(text: str | None) -> str:
    return (text or "").replace("₹", "Rs.").replace("–", "-").replace("—", "-").replace("’", "'").encode("latin-1", "replace").decode("latin-1")


def _money(v) -> str:
    return format_inr(v, symbol="Rs. ", paise=True)


def _package_text(p: dict) -> str:
    """The package name, then one line per item inside it."""
    lines = [_t(p["name"])]
    for it in p.get("items") or []:
        desc = f": {it['description']}" if it.get("description") else ""
        lines.append(_t(f"  - {it['name']}{desc}"))
    return "\n".join(lines)


def _mockups(pdf: Letterhead, packages: list[dict], photos: dict[str, bytes]) -> None:
    """Approved visual mockups, grouped by requirement. Photos that cannot be drawn are skipped."""
    shown = [(p, [photos[x] for x in (p.get("photo_paths") or []) if x in photos]) for p in packages]
    shown = [(p, imgs) for p, imgs in shown if imgs]
    if not shown:
        return
    pdf.ln(2)
    pdf.set_font("Helvetica", "B", 9)
    pdf.set_text_color(*GREY)
    pdf.cell(0, 5, "MOCKUPS", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    for n, (p, imgs) in enumerate(shown, 1):
        if pdf.get_y() + PHOTO_MM + 10 > pdf.h - pdf.b_margin:
            pdf.add_page()
        pdf.set_font("Helvetica", "B", 10)
        pdf.set_text_color(30, 41, 59)
        pdf.cell(0, 6, _t(p["name"]), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        x, y = pdf.l_margin, pdf.get_y()
        for data in imgs:
            if x + PHOTO_MM > pdf.w - pdf.r_margin:
                x, y = pdf.l_margin, y + PHOTO_MM + 3
                if y + PHOTO_MM > pdf.h - pdf.b_margin:
                    pdf.add_page()
                    y = pdf.get_y()
            try:
                pdf.image(BytesIO(data), x=x, y=y, w=PHOTO_MM, h=PHOTO_MM, keep_aspect_ratio=True)
            except Exception:  # noqa: BLE001 - a broken image must not stop the quotation
                log.warning("could not draw a mockup photo", exc_info=True)
                continue
            x += PHOTO_MM + 3
        pdf.set_y(y + PHOTO_MM + 4)


def render(*, number: str, created: date, lead: dict, items: list[dict], subtotal, discount_pct, discount_amount, total, template: dict | None, notes: str | None,
           packages: list[dict] | None = None, photos: dict[str, bytes] | None = None) -> bytes:
    pdf = Letterhead()
    pdf.add_page()

    # title and reference
    pdf.set_font("Helvetica", "B", 18)
    pdf.set_text_color(*ACCENT)
    pdf.cell(pdf.epw / 2, 9, "QUOTATION", new_x=XPos.RIGHT, new_y=YPos.TOP)
    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(*GREY)
    pdf.multi_cell(
        0, 4.5, f"No. {number}\nDate {created:%d %b %Y}",
        align="R", new_x=XPos.LMARGIN, new_y=YPos.NEXT,
    )
    pdf.ln(4)

    # bill to
    contact, company = lead.get("contact") or {}, lead.get("company") or {}
    pdf.set_font("Helvetica", "B", 9)
    pdf.set_text_color(*GREY)
    pdf.cell(0, 5, "PREPARED FOR", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_font("Helvetica", "B", 12)
    pdf.set_text_color(30, 41, 59)
    pdf.cell(0, 6, _t(company.get("name")), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_font("Helvetica", "", 10)
    who = " - ".join(x for x in [contact.get("name"), contact.get("designation")] if x)
    pdf.cell(0, 5, _t(who), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    reach = "   ".join(x for x in [contact.get("phone"), contact.get("email")] if x)
    if reach:
        pdf.set_text_color(*GREY)
        pdf.cell(0, 5, _t(reach), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.ln(4)

    if template and template.get("intro"):
        pdf.set_font("Helvetica", "", 10)
        pdf.set_text_color(51, 65, 85)
        pdf.multi_cell(0, 5, _t(template["intro"]), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.ln(3)

    # items
    pdf.set_font("Helvetica", "", 9.5)
    pdf.set_text_color(30, 41, 59)
    with pdf.table(col_widths=(8, 86, 20, 34, 42), text_align=("CENTER", "LEFT", "RIGHT", "RIGHT", "RIGHT"), line_height=6, padding=1.6,
                   borders_layout="HORIZONTAL_LINES") as table:
        head = table.row()
        for h in ("#", "Requirement" if packages else "Description", "Qty", "Rate / unit" if packages else "Rate", "Amount"):
            head.cell(h)
        for i, p in enumerate(packages or [], 1):
            qty, rate = p["quantity"], p["unit_price"]
            row = table.row()
            row.cell(str(i))
            row.cell(_package_text(p))
            row.cell(f"{float(qty):g}")
            row.cell(_money(rate))
            row.cell(_money(float(qty) * float(rate)))
        for i, it in enumerate([] if packages else items, 1):
            qty, rate = it["quantity"], it["unit_price"]
            row = table.row()
            row.cell(str(i))
            row.cell(_t(it["description"]))
            row.cell(f"{float(qty):g}")
            row.cell(_money(rate))
            row.cell(_money(float(qty) * float(rate)))
    pdf.ln(3)

    # totals
    def line(label: str, value: str, bold: bool = False):
        pdf.set_font("Helvetica", "B" if bold else "", 11 if bold else 10)
        pdf.cell(pdf.epw - 60, 6.5, "", new_x=XPos.RIGHT, new_y=YPos.TOP)
        pdf.cell(25, 6.5, label, align="R", new_x=XPos.RIGHT, new_y=YPos.TOP)
        pdf.cell(35, 6.5, value, align="R", new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    pdf.set_text_color(51, 65, 85)
    line("Subtotal", _money(subtotal))
    if float(discount_pct) > 0:
        line(f"Discount ({float(discount_pct):g}%)", "- " + _money(discount_amount))
    pdf.set_text_color(*ACCENT)
    line("Total", _money(total), bold=True)
    pdf.ln(5)

    if packages:
        _mockups(pdf, packages, photos or {})

    pdf.set_text_color(51, 65, 85)
    if notes:
        pdf.set_font("Helvetica", "B", 9)
        pdf.cell(0, 5, "Notes", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.set_font("Helvetica", "", 9.5)
        pdf.multi_cell(0, 5, _t(notes), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.ln(2)
    if template and template.get("terms"):
        pdf.set_font("Helvetica", "B", 9)
        pdf.cell(0, 5, "Terms", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.set_font("Helvetica", "", 9)
        pdf.set_text_color(*GREY)
        pdf.multi_cell(0, 4.8, _t(template["terms"]), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    if template and template.get("footer"):
        pdf.ln(4)
        pdf.set_font("Helvetica", "I", 10)
        pdf.set_text_color(*ACCENT)
        pdf.multi_cell(0, 5, _t(template["footer"]), align="C", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    return bytes(pdf.output())
