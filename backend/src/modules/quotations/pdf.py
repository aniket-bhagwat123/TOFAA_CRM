"""The quotation as a PDF, on the Tofaa India letterhead: the red top bar, logo and rule on the first page only, and
the contact details, address, GSTIN and 'powered by' band on the last page only. The body is a clean, lightly
shaded table (package, its items underneath, quantity, rate, amount), a total band, mockups and terms.
Core PDF fonts only, so text is kept to what Latin-1 can show (the rupee sign is written 'Rs.')."""
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
PHOTO_MM = 30                # mockup thumbnails: five to a row
PHOTOS_PER_ROW = 5
SLATE = (30, 41, 59)         # headings and figures
MUTED = (100, 116, 139)      # labels and sub-lines
LINE = (226, 232, 240)       # table lines
SHADE = (248, 250, 252)      # header row and total band
GOLD = (161, 128, 58)        # "curated gifting elements" and package totals (as in the agreement)
PILL = (226, 232, 240)       # the "PACKAGE 01" pill
LATER_TOP = 16               # top of the body on pages after the first (no letterhead there)
LOGO = Path(__file__).parent / "assets" / "logo.png"
log = logging.getLogger(__name__)

# The letterhead is drawn at 794 x 1123 px; A4 is 210 x 297 mm.
PX = 210 / 794
SIDE = 64 * PX               # header and footer inset
BODY_SIDE = 72 * PX          # letter body inset
BODY_TOP = (6 + 44 + 60 + 26 + 2 + 40) * PX
FOOTER_H = (2 + 20 + 62 + 22 + 40) * PX
BODY_BOTTOM = FOOTER_H + 32 * PX   # the last page keeps this much room for the footer
PLAIN_BOTTOM = 16                   # other pages only need room for "Page n - continued"


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

    def __init__(self, reserve_footer: bool = True, once: bool = False) -> None:
        """once=False (the agreement): header and footer on every page, as before.
        once=True (the quotation): the header on the first page only and the footer on the last page only; with
        reserve_footer=False the pages use their full height (see render)."""
        super().__init__(format="A4")
        self.set_margins(BODY_SIDE, BODY_TOP, BODY_SIDE)
        self.set_auto_page_break(True, BODY_BOTTOM if reserve_footer else PLAIN_BOTTOM)
        self.once = once
        self.last_page = not once  # with once, set just before output so only the last page gets the footer

    def _draw_icon(self, name: str, x: float, y: float) -> None:
        try:
            self.image(BytesIO(_icon(name)), x=x, y=y, w=14 * PX, h=14 * PX)
        except Exception:  # noqa: BLE001 - an icon must never stop the quotation
            log.warning("could not draw the %s icon", name, exc_info=True)

    def header(self) -> None:
        if self.once and self.page_no() > 1:  # the letterhead is on the first page only
            self.set_xy(self.l_margin, LATER_TOP)
            return
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
        if not self.last_page:  # contact details and the band are on the last page only
            self.set_font("Helvetica", "", 8)
            self.set_text_color(*MUTED)
            self.set_xy(self.l_margin, self.h - 12)
            self.cell(0, 5, f"Page {self.page_no()} - continued on the next page", align="R")
            return
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


# --- the table -----------------------------------------------------------------------------------------------------

COLS = (9, None, 20, 34, 37)  # #, requirement (the rest), qty, rate / unit, amount (mm)
HEAD_H, NAME_H, SUB_H, PAD = 8, 5.2, 4.4, 2.6


def _widths(pdf: FPDF) -> list[float]:
    fixed = sum(w for w in COLS if w)
    return [w if w else pdf.epw - fixed for w in COLS]


def _label(pdf: FPDF, text: str, w: float, h: float, align: str = "L", size: float = 7.5) -> None:
    """A small, spaced, uppercase label (table headings, section titles)."""
    pdf.set_font("Helvetica", "B", size)
    pdf.set_char_spacing(0.6)
    pdf.set_text_color(*MUTED)
    pdf.cell(w, h, text.upper(), align=align)
    pdf.set_char_spacing(0)


def _table_head(pdf: FPDF, title: str) -> None:
    w = _widths(pdf)
    x, y = pdf.l_margin, pdf.get_y()
    pdf.set_fill_color(*SHADE)
    pdf.set_draw_color(*LINE)
    pdf.set_line_width(0.25)
    pdf.rect(x, y, pdf.epw, HEAD_H, "FD")
    pdf.set_xy(x, y)
    for text, width, align in zip(("#", title, "Qty", "Rate / unit", "Amount"), w, ("C", "L", "R", "R", "R")):
        _label(pdf, text, width - (3 if align == "R" else 0), HEAD_H, align)
        if align == "R":
            pdf.set_x(pdf.get_x() + 3)
    pdf.set_xy(x, y + HEAD_H)


def _row(pdf: FPDF, n: int, name: str, subs: list[str], qty: float, rate, title: str) -> None:
    """One package: its name, its items underneath as a quiet list, and the figures on the name's line."""
    w = _widths(pdf)
    pdf.set_font("Helvetica", "", 8.5)
    # each item: (is first line of the item, text); wrapped lines indent under the text, not under the dash
    wrapped = [(i == 0, ln) for s_ in subs for i, ln in enumerate(pdf.multi_cell(w[1] - 10, SUB_H, s_, dry_run=True, output="LINES") or [""])]
    pdf.set_font("Helvetica", "B", 9.5)
    name_lines = pdf.multi_cell(w[1] - 4, NAME_H, name, dry_run=True, output="LINES") or [""]
    height = PAD * 2 + len(name_lines) * NAME_H + len(wrapped) * SUB_H + (1 if wrapped else 0)
    if pdf.get_y() + height > pdf.h - pdf.b_margin:  # keep a package on one page, with the headings above it
        pdf.add_page()
        _table_head(pdf, title)
    x, y = pdf.l_margin, pdf.get_y()

    pdf.set_text_color(*MUTED)
    pdf.set_font("Helvetica", "", 9)
    pdf.set_xy(x, y + PAD)
    pdf.cell(w[0], NAME_H, str(n), align="C")

    pdf.set_text_color(*SLATE)
    pdf.set_font("Helvetica", "B", 9.5)
    pdf.set_xy(x + w[0], y + PAD)
    pdf.multi_cell(w[1] - 4, NAME_H, name, new_x=XPos.LEFT, new_y=YPos.NEXT)
    if wrapped:
        pdf.set_y(pdf.get_y() + 1)
        pdf.set_font("Helvetica", "", 8.5)
        pdf.set_text_color(*MUTED)
        for first, ln in wrapped:
            if first:
                pdf.set_x(x + w[0] + 1)
                pdf.cell(4, SUB_H, "-")
            pdf.set_x(x + w[0] + 5)
            pdf.cell(w[1] - 9, SUB_H, ln, new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    pdf.set_font("Helvetica", "", 9.5)
    pdf.set_text_color(*SLATE)
    fx = x + w[0] + w[1]
    pdf.set_xy(fx, y + PAD)
    pdf.cell(w[2] - 3, NAME_H, f"{float(qty):,g}", align="R")
    pdf.set_x(fx + w[2])
    pdf.cell(w[3] - 3, NAME_H, _money(rate), align="R")
    pdf.set_x(fx + w[2] + w[3])
    pdf.set_font("Helvetica", "B", 9.5)
    pdf.cell(w[4] - 3, NAME_H, _money(float(qty) * float(rate)), align="R")

    bottom = y + height
    pdf.set_draw_color(*LINE)
    pdf.set_line_width(0.25)
    pdf.line(x, bottom, x + pdf.epw, bottom)
    pdf.set_xy(x, bottom)


def _items_table(pdf: FPDF, packages: list[dict] | None, items: list[dict]) -> float:
    """The table, then a quiet total-quantity line and a strong rule under it. Returns the total quantity."""
    title = "Requirement" if packages else "Description"
    _table_head(pdf, title)
    total_qty = 0.0
    if packages:
        for i, p in enumerate(packages, 1):
            subs = [_t(it["name"] + (f": {it['description']}" if it.get("description") else "")) for it in (p.get("items") or [])]
            _row(pdf, i, _t(p["name"]), subs, p["quantity"], p["unit_price"], title)
            total_qty += float(p["quantity"])
    else:
        for i, it in enumerate(items, 1):
            _row(pdf, i, _t(it["description"]), [], it["quantity"], it["unit_price"], title)
            total_qty += float(it["quantity"])
    # total quantity, then the heavy rule that closes the table (as in the agreement)
    w = _widths(pdf)
    if pdf.get_y() + 9 > pdf.h - pdf.b_margin:
        pdf.add_page()
    x, y = pdf.l_margin, pdf.get_y()
    pdf.set_fill_color(*SHADE)
    pdf.rect(x, y, pdf.epw, 8, "F")
    pdf.set_xy(x + w[0], y)
    pdf.set_font("Helvetica", "B", 9)
    pdf.set_text_color(*SLATE)
    pdf.cell(w[1], 8, "Total quantity")
    pdf.cell(w[2] - 3, 8, f"{total_qty:,g} pcs", align="R")
    pdf.set_draw_color(*SLATE)
    pdf.set_line_width(0.7)
    pdf.line(x, y + 8, x + pdf.epw, y + 8)
    pdf.set_line_width(0.2)
    pdf.set_xy(x, y + 8)
    return total_qty


def _totals(pdf: FPDF, subtotal, discount_pct, discount_amount, total) -> None:
    """Subtotal and discount as quiet lines, then the grand total in a shaded band."""
    rows = [("Subtotal", _money(subtotal))]
    if float(discount_pct) > 0:
        rows.append((f"Discount ({float(discount_pct):g}%)", "- " + _money(discount_amount)))
    if pdf.get_y() + 8 + len(rows) * 6 + 14 > pdf.h - pdf.b_margin:
        pdf.add_page()
    pdf.ln(2)
    x = pdf.l_margin
    for label, value in rows:
        pdf.set_x(x)
        pdf.set_font("Helvetica", "", 9.5)
        pdf.set_text_color(*MUTED)
        pdf.cell(pdf.epw - 40, 6, label, align="R")
        pdf.set_text_color(*SLATE)
        pdf.cell(37, 6, value, align="R", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.ln(1.5)
    y = pdf.get_y()
    pdf.set_fill_color(*SHADE)
    pdf.set_draw_color(*LINE)
    pdf.rect(x, y, pdf.epw, 11, "FD", round_corners=True, corner_radius=1.5)
    pdf.set_xy(x, y)
    pdf.set_font("Helvetica", "B", 9.5)
    pdf.set_char_spacing(0.8)
    pdf.set_text_color(*SLATE)
    pdf.cell(pdf.epw - 40, 11, "TOTAL QUOTATION VALUE", align="R")
    pdf.set_char_spacing(0)
    pdf.set_font("Helvetica", "B", 12)
    pdf.set_text_color(*ACCENT)
    pdf.cell(37, 11, _money(total), align="R", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.ln(5)


# --- package cards (a quotation with requirements) ----------------------------------------------------------------

CARD_HEAD, CARD_PAD, ROW_MIN, THUMB = 13, 4.5, 7, 24
DEFAULT_SPEC = "Standard specification as per approved sample"
SIGN_OFF = "Visual benchmark / sample sign-off scheduled prior to bulk production"


def _spaced(pdf: FPDF, text: str, size: float, style: str = "B", spacing: float = 0.8) -> float:
    """Width of a small spaced uppercase label."""
    pdf.set_font("Helvetica", style, size)
    pdf.set_char_spacing(spacing)
    w = pdf.get_string_width(text)
    pdf.set_char_spacing(0)
    return w


def _card_rows(pdf: FPDF, p: dict, name_w: float, spec_w: float, start: int) -> list[tuple[str, list[str], list[str], float]]:
    """(no., item name lines, spec lines, row height) for each item in the package. Long text wraps, nothing is cut."""
    def wrap(text: str, width: float, style: str) -> list[str]:
        pdf.set_font("Helvetica", style, 8.5)
        return pdf.multi_cell(width - 4, 4.4, text, dry_run=True, output="LINES") or [text]

    rows = []
    for i, it in enumerate(p.get("items") or [], start):
        name = wrap(_t(it["name"]), name_w, "B")
        spec = wrap(_t(it.get("description") or DEFAULT_SPEC), spec_w, "")
        rows.append((f"{i:02d}", name, spec, max(ROW_MIN, max(len(name), len(spec)) * 4.4 + 2.8)))
    return rows


def _package_card(pdf: FPDF, n: int, p: dict, photos: dict[str, bytes], start: int = 1, last: bool = True) -> None:
    """One requirement as a card: PACKAGE pill, name and figures on top; its items as a small table; its mockups
    (or the sample sign-off note) at the bottom. Kept on one page."""
    x, w = pdf.l_margin, pdf.epw
    inner_x, inner_w = x + 5, w - 10
    cols = (14, 58, inner_w - 72)  # sr., item name, specifications & finish
    rows = _card_rows(pdf, p, cols[1], cols[2], start)
    imgs = [photos[k] for k in (p.get("photo_paths") or []) if k in photos]
    per_row = max(1, int((inner_w + 3) // (THUMB + 3)))
    photo_h = ((len(imgs) + per_row - 1) // per_row) * (THUMB + 3) - 3 if imgs else 9
    table_h = (7 + sum(r[3] for r in rows)) if rows else 0

    # The head: pill + name on the left; on the right three compact figure blocks (small label above, value below),
    # split by thin dividers. Narrow enough that name and figures share one line; a long name wraps in its own space.
    pill = f"PACKAGE {n:02d}"  # the same on a continued card: the item numbers show it carries on
    pill_w = _spaced(pdf, pill, 7.5) + 5
    qty, rate = float(p["quantity"]), p["unit_price"]
    parts = [("VOLUME", f"{qty:,g} pcs", SLATE), ("RATE / UNIT", _money(rate), SLATE), ("PACKAGE TOTAL", _money(qty * float(rate)), GOLD)]
    blocks = []
    for label, value, colour in parts:
        pdf.set_font("Helvetica", "B", 9.5)
        blocks.append((label, value, colour, max(pdf.get_string_width(value), _spaced(pdf, label, 6, spacing=0.5))))
    gap = 4  # either side of a divider
    figs_w = sum(b[3] for b in blocks) + 2 * gap * (len(blocks) - 1)
    name_x = x + 4 + pill_w + 4
    room = (x + w - 5) - figs_w - 6 - name_x
    pdf.set_font("Helvetica", "B", 11.5)
    name_lines = pdf.multi_cell(room, 5.4, _t(p["name"]), dry_run=True, output="LINES") or [""]
    name_lines = name_lines[:2] if len(name_lines) <= 2 else [name_lines[0], name_lines[1][: max(1, len(name_lines[1]) - 3)] + "..."]
    head_h = max(CARD_HEAD + 2, len(name_lines) * 5.4 + 6)

    foot_h = 0.3 + CARD_PAD + photo_h + CARD_PAD if last else 0  # mockups close the package's last card
    height = head_h + CARD_PAD + (6 + table_h + CARD_PAD if rows else 0) + foot_h
    if height > pdf.h - pdf.t_margin - pdf.b_margin and len(rows) > 1:  # too long for one page: continue on another card
        items = p["items"]
        half = len(items) // 2
        _package_card(pdf, n, {**p, "items": items[:half]}, photos, start, last=False)
        _package_card(pdf, n, {**p, "items": items[half:]}, photos, start + half, last)
        return
    if pdf.get_y() + height > pdf.h - pdf.b_margin:
        pdf.add_page()
    y = pdf.get_y()

    # the frame and the shaded head
    pdf.set_draw_color(*LINE)
    pdf.set_line_width(0.3)
    pdf.set_fill_color(*SHADE)
    pdf.rect(x, y, w, head_h, "F", round_corners=("TOP_LEFT", "TOP_RIGHT"), corner_radius=2)
    pdf.line(x, y + head_h, x + w, y + head_h)
    pdf.rect(x, y, w, height, "D", round_corners=True, corner_radius=2)

    # head, left: the pill (centred on the head) and the name
    mid = y + head_h / 2
    pdf.set_fill_color(*PILL)
    pdf.rect(x + 4, mid - 3, pill_w, 6, "F", round_corners=True, corner_radius=1.2)
    pdf.set_xy(x + 4, mid - 3)
    pdf.set_font("Helvetica", "B", 7.5)
    pdf.set_char_spacing(0.8)
    pdf.set_text_color(71, 85, 105)
    pdf.cell(pill_w, 6, pill, align="C")
    pdf.set_char_spacing(0)
    pdf.set_font("Helvetica", "B", 11.5)
    pdf.set_text_color(*SLATE)
    ny = mid - len(name_lines) * 5.4 / 2
    for ln in name_lines:
        pdf.set_xy(name_x, ny)
        pdf.cell(room, 5.4, ln)
        ny += 5.4

    # head, right: the figure blocks, right-aligned, label above value
    bx = x + w - 5 - figs_w
    for i, (label, value, colour, bw) in enumerate(blocks):
        if i:
            pdf.set_draw_color(*LINE)
            pdf.set_line_width(0.3)
            pdf.line(bx + gap, mid - 4, bx + gap, mid + 4)
            bx += 2 * gap
        pdf.set_xy(bx, mid - 4.6)
        pdf.set_font("Helvetica", "B", 6)
        pdf.set_char_spacing(0.5)
        pdf.set_text_color(*MUTED)
        pdf.cell(bw, 3.6, label, align="R")
        pdf.set_char_spacing(0)
        pdf.set_xy(bx, mid - 0.6)
        pdf.set_font("Helvetica", "B", 9.5)
        pdf.set_text_color(*colour)
        pdf.cell(bw, 5, value, align="R")
        bx += bw

    cy = y + head_h + CARD_PAD
    if rows:
        # "• CURATED GIFTING ELEMENTS"
        pdf.set_fill_color(*GOLD)
        pdf.ellipse(inner_x + 0.3, cy + 1.6, 1.4, 1.4, "F")
        pdf.set_xy(inner_x + 3, cy)
        pdf.set_font("Helvetica", "B", 7.5)
        pdf.set_char_spacing(1)
        pdf.set_text_color(*GOLD)
        pdf.cell(0, 4.6, "CURATED GIFTING ELEMENTS")
        pdf.set_char_spacing(0)
        cy += 6

        # the items table
        pdf.set_fill_color(*SHADE)
        pdf.set_draw_color(*LINE)
        pdf.set_line_width(0.25)
        pdf.rect(inner_x, cy, inner_w, 7, "FD")
        hx = inner_x
        for text, cw in zip(("SR.", "ITEM NAME", "SPECIFICATIONS & FINISH"), cols):
            pdf.set_xy(hx + (0 if text == "SR." else 3), cy)
            pdf.set_font("Helvetica", "B", 7)
            pdf.set_char_spacing(0.6)
            pdf.set_text_color(51, 65, 85)
            pdf.cell(cw - 3 if text != "SR." else cw, 7, text, align="C" if text == "SR." else "L")
            pdf.set_char_spacing(0)
            hx += cw
        cy += 7
        for no, names, lines, rh in rows:
            pdf.set_xy(inner_x, cy)
            pdf.set_font("Helvetica", "B", 8.5)
            pdf.set_text_color(*SLATE)
            pdf.cell(cols[0], ROW_MIN, no, align="C")
            ny = cy + (ROW_MIN - 4.4) / 2 if len(names) == 1 else cy + 1.4
            for ln in names:
                pdf.set_xy(inner_x + cols[0] + 3, ny)
                pdf.cell(cols[1] - 4, 4.4, ln)
                ny += 4.4
            pdf.set_font("Helvetica", "", 8.5)
            pdf.set_text_color(51, 65, 85)
            ly = cy + (ROW_MIN - 4.4) / 2 if len(lines) == 1 else cy + 1.4
            for ln in lines:
                pdf.set_xy(inner_x + cols[0] + cols[1] + 3, ly)
                pdf.cell(cols[2] - 4, 4.4, ln)
                ly += 4.4
            pdf.set_draw_color(*LINE)
            pdf.rect(inner_x, cy, inner_w, rh, "D")
            cy += rh
        cy += CARD_PAD

    # bottom: mockups, or the sample sign-off note
    if not last:
        pdf.set_xy(x, y + height + 5)
        return
    pdf.set_draw_color(*LINE)
    pdf.line(x, cy, x + w, cy)
    cy += CARD_PAD
    if imgs:
        px, py = inner_x, cy
        for i, data in enumerate(imgs):
            if i and i % per_row == 0:
                px, py = inner_x, py + THUMB + 3
            try:
                pdf.image(BytesIO(data), x=px, y=py, w=THUMB, h=THUMB, keep_aspect_ratio=True)
            except Exception:  # noqa: BLE001 - a broken image must not stop the quotation
                log.warning("could not draw a mockup photo", exc_info=True)
            pdf.set_draw_color(*LINE)
            pdf.rect(px, py, THUMB, THUMB, "D", round_corners=True, corner_radius=1.2)
            px += THUMB + 3
    else:
        pdf.set_draw_color(203, 213, 225)
        pdf.set_dash_pattern(dash=1, gap=0.8)
        pdf.rect(inner_x, cy, inner_w, 9, "D", round_corners=True, corner_radius=1.5)
        pdf.set_dash_pattern()
        pdf.set_xy(inner_x, cy)
        pdf.set_font("Helvetica", "I", 8)
        pdf.set_text_color(*MUTED)
        pdf.cell(inner_w, 9, SIGN_OFF, align="C")
    pdf.set_xy(x, y + height + 5)


def _package_cards(pdf: FPDF, packages: list[dict], photos: dict[str, bytes]) -> None:
    """Every requirement as a card, then the total volume line closing the schedule."""
    for i, p in enumerate(packages, 1):
        _package_card(pdf, i, p, photos)
    total_qty = sum(float(p["quantity"]) for p in packages)
    if pdf.get_y() + 9 > pdf.h - pdf.b_margin:
        pdf.add_page()
    x, y = pdf.l_margin, pdf.get_y() - 1
    pdf.set_fill_color(*SHADE)
    pdf.rect(x, y, pdf.epw, 8, "F")
    pdf.set_xy(x + 4, y)
    pdf.set_font("Helvetica", "B", 9)
    pdf.set_text_color(*SLATE)
    pdf.cell(pdf.epw / 2, 8, f"Total volume ({len(packages)} package{'s' if len(packages) != 1 else ''})")
    pdf.set_xy(x, y)
    pdf.cell(pdf.epw - 4, 8, f"{total_qty:,g} pcs", align="R")
    pdf.set_draw_color(*SLATE)
    pdf.set_line_width(0.7)
    pdf.line(x, y + 8, x + pdf.epw, y + 8)
    pdf.set_line_width(0.2)
    pdf.set_xy(x, y + 8)


def _section(pdf: FPDF, title: str) -> None:
    if pdf.get_y() + 14 > pdf.h - pdf.b_margin:
        pdf.add_page()
    _label(pdf, title, 0, 6, size=8)
    pdf.ln(6)
    y = pdf.get_y()
    pdf.set_draw_color(*LINE)
    pdf.set_line_width(0.25)
    pdf.line(pdf.l_margin, y, pdf.l_margin + pdf.epw, y)
    pdf.ln(2.5)


def render(*, number: str, created: date, lead: dict, items: list[dict], subtotal, discount_pct, discount_amount, total, template: dict | None, notes: str | None,
           packages: list[dict] | None = None, photos: dict[str, bytes] | None = None) -> bytes:
    """Lay the quotation out using each page's full height, so it fits on as few pages as possible. If the letterhead
    footer then does not fit under the content on the last page, lay it out again keeping the footer's room."""
    args = dict(number=number, created=created, lead=lead, items=items, subtotal=subtotal, discount_pct=discount_pct,
                discount_amount=discount_amount, total=total, template=template, notes=notes, packages=packages, photos=photos)
    pdf = _build(Letterhead(reserve_footer=False, once=True), **args)
    if pdf.get_y() > pdf.h - BODY_BOTTOM:
        pdf = _build(Letterhead(reserve_footer=True, once=True), **args)
    pdf.last_page = True  # the footer of the page being finished now is the full letterhead footer
    return bytes(pdf.output())


def _build(pdf: Letterhead, *, number: str, created: date, lead: dict, items: list[dict], subtotal, discount_pct, discount_amount, total,
           template: dict | None, notes: str | None, packages: list[dict] | None, photos: dict[str, bytes] | None) -> Letterhead:
    pdf.add_page()

    # title and reference
    pdf.set_font("Helvetica", "B", 18)
    pdf.set_text_color(*ACCENT)
    pdf.cell(pdf.epw / 2, 9, "QUOTATION", new_x=XPos.RIGHT, new_y=YPos.TOP)
    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(*MUTED)
    pdf.multi_cell(0, 4.5, f"No. {number}\nDate {created:%d %b %Y}", align="R", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.ln(3)

    # prepared for
    contact, company = lead.get("contact") or {}, lead.get("company") or {}
    _label(pdf, "Prepared for", 0, 5, size=8)
    pdf.ln(5)
    pdf.set_font("Helvetica", "B", 12)
    pdf.set_text_color(*SLATE)
    pdf.cell(0, 6, _t(company.get("name")), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_font("Helvetica", "", 9.5)
    who = " - ".join(x for x in [contact.get("name"), contact.get("designation")] if x)
    if who:
        pdf.cell(0, 5, _t(who), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    reach = "   |   ".join(x for x in [contact.get("phone"), contact.get("email")] if x)
    if reach:
        pdf.set_text_color(*MUTED)
        pdf.cell(0, 5, _t(reach), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.ln(4)

    if template and template.get("intro"):
        pdf.set_font("Helvetica", "", 9.5)
        pdf.set_text_color(51, 65, 85)
        pdf.multi_cell(0, 5, _t(template["intro"]), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.ln(3)

    if packages:  # each requirement as a card, its mockups inside it
        _package_cards(pdf, packages, photos or {})
    else:
        _items_table(pdf, packages, items)
    _totals(pdf, subtotal, discount_pct, discount_amount, total)

    if notes:
        _section(pdf, "Notes")
        pdf.set_font("Helvetica", "", 9)
        pdf.set_text_color(51, 65, 85)
        pdf.multi_cell(0, 4.8, _t(notes), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.ln(3)
    if template and template.get("terms"):
        _section(pdf, "Terms & conditions")
        pdf.set_font("Helvetica", "", 8.8)
        pdf.set_text_color(*MUTED)
        pdf.multi_cell(0, 4.8, _t(template["terms"]), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    if template and template.get("footer"):
        pdf.ln(5)
        pdf.set_font("Helvetica", "I", 10)
        pdf.set_text_color(*ACCENT)
        pdf.multi_cell(0, 5, _t(template["footer"]), align="C", new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    return pdf
