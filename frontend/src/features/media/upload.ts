import { apiClient } from "@/services/api-client";

/** PUT a photo as multipart. Paths: /users/me/avatar, /users/{id}/avatar, /leads/{id}/photo. */
export async function uploadPhoto(path: string, file: File): Promise<string | null> {
  const form = new FormData();
  form.append("file", file);
  const res = await apiClient.put<{ avatarUrl?: string; photoUrl?: string }>(path, form);
  return res.data.avatarUrl ?? res.data.photoUrl ?? null;
}

export const removePhoto = async (path: string) => {
  await apiClient.delete(path);
};
