"""The quotation as a PDF. Core PDF fonts only, so text is kept to what Latin-1 can show (the rupee sign is written 'Rs.')."""
from datetime import date, timedelta

from fpdf import FPDF
from fpdf.enums import XPos, YPos

from src.core.config import settings
from src.core.money import format_inr

VIOLET = (124, 58, 237)
GREY = (100, 116, 139)


def _t(text: str | None) -> str:
    return (text or "").replace("₹", "Rs.").replace("–", "-").replace("—", "-").replace("’", "'").encode("latin-1", "replace").decode("latin-1")


def _money(v) -> str:
    return format_inr(v, symbol="Rs. ", paise=True)


def render(*, number: str, created: date, valid_days: int, lead: dict, items: list[dict], subtotal, discount_pct, discount_amount, total, template: dict | None, notes: str | None) -> bytes:
    pdf = FPDF(format="A4")
    pdf.set_auto_page_break(True, 18)
    pdf.add_page()
    pdf.set_margins(10, 12, 10)

    # header
    pdf.set_font("Helvetica", "B", 20)
    pdf.set_text_color(*VIOLET)
    pdf.cell(110, 10, _t(settings.COMPANY_NAME), new_x=XPos.RIGHT, new_y=YPos.TOP)
    pdf.set_font("Helvetica", "B", 16)
    pdf.set_text_color(30, 41, 59)
    pdf.cell(0, 10, "QUOTATION", align="R", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(*GREY)
    if settings.COMPANY_ADDRESS:
        pdf.multi_cell(110, 4.5, _t(settings.COMPANY_ADDRESS), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_y(max(pdf.get_y(), 30))
    pdf.cell(0, 5, f"No. {number}   |   Date {created:%d %b %Y}   |   Valid until {(created + timedelta(days=valid_days)):%d %b %Y}", align="R", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
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
        for h in ("#", "Description", "Qty", "Rate", "Amount"):
            head.cell(h)
        for i, it in enumerate(items, 1):
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
        pdf.cell(130, 6.5, "", new_x=XPos.RIGHT, new_y=YPos.TOP)
        pdf.cell(25, 6.5, label, align="R", new_x=XPos.RIGHT, new_y=YPos.TOP)
        pdf.cell(35, 6.5, value, align="R", new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    pdf.set_text_color(51, 65, 85)
    line("Subtotal", _money(subtotal))
    if float(discount_pct) > 0:
        line(f"Discount ({float(discount_pct):g}%)", "- " + _money(discount_amount))
    pdf.set_text_color(*VIOLET)
    line("Total", _money(total), bold=True)
    pdf.ln(5)

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
        pdf.set_text_color(*VIOLET)
        pdf.multi_cell(0, 5, _t(template["footer"]), align="C", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    return bytes(pdf.output())
