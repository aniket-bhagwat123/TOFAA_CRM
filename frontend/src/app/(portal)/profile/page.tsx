import { ProfileForm } from "@/components/profile/profile-form";
import { ResetPasswordCard } from "@/components/profile/reset-password-card";
import { PageHeader } from "@/components/ui/page-header";

export default function ProfilePage() {
  return (
    <div>
      <PageHeader title="Profile" />
      {/* Your details on the left, reset password on the right. */}
      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <ProfileForm />
        <div className="flex flex-col gap-4">
          <ResetPasswordCard />
        </div>
      </div>
    </div>
  );
}
