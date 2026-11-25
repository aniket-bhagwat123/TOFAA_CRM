import { toast } from "sonner";
import { apiClient, errorMessage } from "@/services/api-client";

/** A refused download comes back as a Blob too: read the server's message out of it. */
async function blobError(e: unknown, fallback: string) {
  const data = (e as { response?: { data?: unknown } })?.response?.data;
  if (data instanceof Blob) {
    try {
      const body = JSON.parse(await data.text()) as { message?: string };
      if (body.message) { toast.error(body.message); return; }
    } catch { /* not JSON */ }
  }
  toast.error(errorMessage(e, fallback));
}

/** Download a file the API protects (export, template): saved under the name the server gives, or `fallbackName`. */
export async function downloadFile(path: string, params: Record<string, unknown>, fallbackName: string) {
  try {
    const res = await apiClient.get<Blob>(path, { params, responseType: "blob" });
    const header = String((res.headers as Record<string, string>)["content-disposition"] ?? "");
    const name = /filename="?([^";]+)"?/.exec(header)?.[1] ?? fallbackName;
    const url = URL.createObjectURL(res.data as unknown as Blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    await blobError(e, "Could not download the file.");
  }
}

/** Fetch a file the API protects (it needs the sign-in token) and open it in a new tab. */
export async function openPdf(path: string) {
  try {
    const res = await apiClient.get<Blob>(path, { responseType: "blob" });
    const url = URL.createObjectURL(new Blob([res.data as unknown as BlobPart], { type: "application/pdf" }));
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    await blobError(e, "Could not open the PDF.");
  }
}
