import { toast } from "sonner";
import { apiClient, errorMessage } from "@/services/api-client";

/** Fetch a file the API protects (it needs the sign-in token) and open it in a new tab. */
export async function openPdf(path: string) {
  try {
    const res = await apiClient.get<Blob>(path, { responseType: "blob" });
    const url = URL.createObjectURL(new Blob([res.data as unknown as BlobPart], { type: "application/pdf" }));
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    // A refused download comes back as a Blob too: read the server's message out of it.
    const data = (e as { response?: { data?: unknown } })?.response?.data;
    if (data instanceof Blob) {
      try {
        const body = JSON.parse(await data.text()) as { message?: string };
        if (body.message) { toast.error(body.message); return; }
      } catch { /* not JSON */ }
    }
    toast.error(errorMessage(e, "Could not open the PDF."));
  }
}
