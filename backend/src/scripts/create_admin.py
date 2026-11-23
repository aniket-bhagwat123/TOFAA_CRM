"""Create the first Admin (super admin). Everyone else is added from the Users screen.

Run it from the backend folder, with the same Supabase settings the deployed backend uses (backend/.env):

    python -m src.scripts.create_admin "Full Name" --email you@company.com
    python -m src.scripts.create_admin "Full Name" --email you@company.com --phone 9876543210
    python -m src.scripts.create_admin "Full Name" --email you@company.com --password "Str0ngPass!"

Without --password you are asked for one (it is not shown while you type).
If the email already has an account, it is made an active Admin and given the new password,
so the script also works to recover a locked-out admin.
"""
import argparse
import getpass
import re
import sys

from src.core.supabase import get_service_client
from src.modules.auth.service import normalize_identifier


def strong(p: str) -> bool:
    return len(p) >= 8 and bool(re.search(r"[a-z]", p) and re.search(r"[A-Z]", p) and re.search(r"\d", p))


def ask_password() -> str:
    while True:
        p = getpass.getpass("Password (8+ characters, upper and lower case and a number): ")
        if not strong(p):
            print("  Too weak. Use 8 or more characters with upper and lower case letters and a number.")
            continue
        if getpass.getpass("Type it again: ") != p:
            print("  They do not match. Try again.")
            continue
        return p


def find_auth_user(db, email: str):
    page = 1
    while True:
        users = db.auth.admin.list_users(page=page, per_page=1000)
        if not users:
            return None
        for u in users:
            if (u.email or "").lower() == email:
                return u
        page += 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("name", help="the admin's full name")
    ap.add_argument("--email", required=True, help="the email they sign in with")
    ap.add_argument("--phone", help="optional 10-digit mobile number")
    ap.add_argument("--password", help="optional; asked for if left out")
    args = ap.parse_args()

    email = args.email.strip().lower()
    password = args.password or ask_password()
    if not strong(password):
        ap.error("the password needs 8+ characters with upper and lower case letters and a number")
    phone = normalize_identifier(args.phone)[1] if args.phone else None

    db = get_service_client()
    attrs = {"email": email, "email_confirm": True, "password": password}
    if phone:
        attrs.update(phone=phone, phone_confirm=True)

    existing = find_auth_user(db, email)
    if existing:
        db.auth.admin.update_user_by_id(existing.id, attrs)
        user_id = existing.id
        action = "updated (now an active Admin, password changed)"
    else:
        user_id = db.auth.admin.create_user(attrs).user.id
        action = "created"

    profile = {"id": user_id, "email": email, "full_name": args.name.strip(), "role": "admin", "is_active": True}
    if phone:
        profile["phone"] = phone
    try:
        db.table("profiles").upsert(profile, on_conflict="id").execute()
    except Exception:
        if not existing:  # do not leave a sign-in account without a profile
            db.auth.admin.delete_user(user_id)
        raise

    print(f"Admin {action}: {args.name.strip()} <{email}>")
    print("Sign in on the login page with this email and password.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
