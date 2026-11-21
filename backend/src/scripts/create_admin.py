"""Create the first Admin. Everyone else is added from Settings > Users.

    python -m src.scripts.create_admin "Full Name" --email you@company.com
    python -m src.scripts.create_admin "Full Name" --phone 9876543210
"""
import argparse
import sys

from src.core.supabase import get_service_client
from src.modules.auth.service import normalize_identifier


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("name")
    ap.add_argument("--email")
    ap.add_argument("--phone")
    args = ap.parse_args()
    if not args.email and not args.phone:
        ap.error("give --email or --phone")

    attrs, phone = {}, None
    if args.email:
        attrs.update(email=args.email.lower(), email_confirm=True)
    if args.phone:
        _, phone = normalize_identifier(args.phone)
        attrs.update(phone=phone, phone_confirm=True)

    db = get_service_client()
    created = db.auth.admin.create_user(attrs)
    db.table("profiles").insert(
        {"id": created.user.id, "email": args.email and args.email.lower(), "phone": phone, "full_name": args.name, "role": "admin"}
    ).execute()
    print(f"Admin created: {args.name}. Sign in at the login page with a one-time code.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
