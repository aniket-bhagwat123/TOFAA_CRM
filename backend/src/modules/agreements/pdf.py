"""The prepared agreement as a PDF, on the same letterhead as the quotation: parties, requirement packages, scope of
work, commercials, contract terms, remarks and the two signature blocks."""
from datetime import date

from fpdf.enums import XPos, YPos

from src.core.config import settings
from src.modules.quotations.pdf import ACCENT, GREY, INK, Letterhead, _money, _package_text, _t


def _heading(pdf: Letterhead, text: str) -> None:
    if pdf.get_y() + 20 > pdf.h - pdf.b_margin:
        pdf.add_page()
    pdf.ln(3)
    pdf.set_font("Helvetica", "B", 9)
    pdf.set_text_color(*ACCENT)
    pdf.cell(0, 6, text.upper(), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_text_color(*INK)


def render(*, number: str, created: date, lead: dict, details: dict, scope_labels: dict[str, str]) -> bytes:
    pdf = Letterhead()
    pdf.add_page()

    # title and reference
    pdf.set_font("Helvetica", "B", 18)
    pdf.set_text_color(*ACCENT)
    pdf.cell(pdf.epw / 2, 9, "AGREEMENT", new_x=XPos.RIGHT, new_y=YPos.TOP)
    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(*GREY)
    pdf.multi_cell(0, 4.5, f"No. {number}\nDate {created:%d %b %Y}", align="R", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.ln(3)

    # parties
    contact, company = lead.get("contact") or {}, lead.get("company") or {}
    half = pdf.epw / 2
    y = pdf.get_y()
    for i, (label, name, who) in enumerate((
        ("BETWEEN", settings.COMPANY_NAME, settings.COMPANY_ADDRESS.replace("\\n", ", ") if settings.COMPANY_ADDRESS else ""),
        ("AND THE CLIENT", company.get("name"), " - ".join(x for x in [contact.get("name"), contact.get("designation")] if x)),
    )):
        pdf.set_xy(pdf.l_margin + i * half, y)
        pdf.set_font("Helvetica", "B", 8.5)
        pdf.set_text_color(*GREY)
        pdf.cell(half - 4, 5, label, new_x=XPos.LEFT, new_y=YPos.NEXT)
        pdf.set_font("Helvetica", "B", 11)
        pdf.set_text_color(*INK)
        pdf.cell(half - 4, 6, _t(name), new_x=XPos.LEFT, new_y=YPos.NEXT)
        pdf.set_font("Helvetica", "", 9)
        pdf.set_text_color(*GREY)
        pdf.multi_cell(half - 4, 4.5, _t(who), new_x=XPos.LEFT, new_y=YPos.NEXT)
    pdf.set_y(y + 22)

    # requirement packages
    _heading(pdf, "Requirement packages")
    pdf.set_font("Helvetica", "", 9.5)
    with pdf.table(col_widths=(8, 86, 20, 34, 42), text_align=("CENTER", "LEFT", "RIGHT", "RIGHT", "RIGHT"), line_height=6, padding=1.6,
                   borders_layout="HORIZONTAL_LINES") as table:
        head = table.row()
        for h in ("#", "Requirement", "Qty", "Rate / unit", "Amount"):
            head.cell(h)
        for i, p in enumerate(details.get("packages") or [], 1):
            row = table.row()
            row.cell(str(i))
            row.cell(_package_text(p))
            row.cell(f"{float(p['quantity']):g}")
            row.cell(_money(p["unit_price"]))
            row.cell(_money(float(p["quantity"]) * float(p["unit_price"])))

    # scope of work
    scope = [scope_labels.get(s, s) for s in details.get("scope") or [] if s != "other"]
    if "other" in (details.get("scope") or []) and details.get("scopeOther"):
        scope.append(details["scopeOther"])
    if scope:
        _heading(pdf, "Scope of work")
        pdf.set_font("Helvetica", "", 9.5)
        col = pdf.epw / 2
        for i, item in enumerate(scope):
            x = pdf.l_margin + (i % 2) * col
            if i % 2 == 0 and i:
                pdf.ln(5.5)
            pdf.set_x(x)
            pdf.cell(col, 5.5, _t(f"- {item}"))
        pdf.ln(7)

    # commercials
    t = details.get("totals") or {}
    _heading(pdf, "Project cost & commercials")

    def line(label: str, value: str, bold: bool = False):
        pdf.set_font("Helvetica", "B" if bold else "", 11 if bold else 9.5)
        pdf.cell(pdf.epw - 70, 6, "", new_x=XPos.RIGHT, new_y=YPos.TOP)
        pdf.cell(35, 6, label, align="R", new_x=XPos.RIGHT, new_y=YPos.TOP)
        pdf.cell(35, 6, value, align="R", new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    pdf.set_text_color(51, 65, 85)
    line("Total volume", f"{float(t.get('units') or 0):g} pcs")
    line("Base subtotal", _money(t.get("base") or 0))
    line("Avg rate / unit", _money(t.get("avgRate") or 0))
    if t.get("transportation"):
        line("Transportation", _money(t["transportation"]))
    line(f"GST ({float(t.get('gstRate') or 0):g}%)", _money(t.get("gst") or 0))
    pdf.set_text_color(*ACCENT)
    line("Total project cost", _money(t.get("total") or 0), bold=True)
    pdf.set_text_color(*INK)

    # terms
    terms = details.get("terms") or []
    if terms:
        _heading(pdf, "Contract terms & policies")
        for i, term in enumerate(terms, 1):
            if pdf.get_y() + 14 > pdf.h - pdf.b_margin:
                pdf.add_page()
            pdf.set_font("Helvetica", "B", 9.5)
            pdf.set_text_color(*INK)
            pdf.cell(0, 5.5, _t(f"{i:02d}. {term.get('title')}"), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
            pdf.set_font("Helvetica", "", 9)
            pdf.set_text_color(*GREY)
            pdf.multi_cell(0, 4.6, _t(term.get("body")), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
            pdf.ln(1.5)

    if details.get("remarks"):
        _heading(pdf, "Remarks")
        pdf.set_font("Helvetica", "", 9.5)
        pdf.set_text_color(*INK)
        pdf.multi_cell(0, 5, _t(details["remarks"]), new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    # signatures
    if pdf.get_y() + 34 > pdf.h - pdf.b_margin:
        pdf.add_page()
    pdf.ln(12)
    y = pdf.get_y()
    for i, (label, name) in enumerate(((f"For {settings.COMPANY_NAME}", details.get("tofaaSignee")), (f"For {company.get('name') or 'the Client'}", details.get("clientSignee")))):
        x = pdf.l_margin + i * half
        pdf.set_draw_color(*GREY)
        pdf.line(x, y + 12, x + half - 12, y + 12)
        pdf.set_xy(x, y + 13)
        pdf.set_font("Helvetica", "B", 9.5)
        pdf.set_text_color(*INK)
        pdf.cell(half - 12, 5, _t(name or "Name"), new_x=XPos.LEFT, new_y=YPos.NEXT)
        pdf.set_font("Helvetica", "", 8.5)
        pdf.set_text_color(*GREY)
        pdf.cell(half - 12, 4.5, _t(label), new_x=XPos.LEFT, new_y=YPos.NEXT)
        pdf.cell(half - 12, 4.5, "Signature & date", new_x=XPos.LEFT, new_y=YPos.NEXT)
    return bytes(pdf.output())
