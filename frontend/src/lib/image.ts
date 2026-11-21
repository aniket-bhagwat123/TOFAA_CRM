const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];
export const ACCEPT_ATTR = ACCEPTED.join(",");
const MAX_INPUT_BYTES = 15 * 1024 * 1024;

/** Shrinks a photo in the browser before upload (max 720 px, JPEG), so phone photos upload fast and fit the 2 MB limit. */
export async function prepareImage(file: File, maxSide = 720): Promise<File> {
  if (!ACCEPTED.includes(file.type)) throw new Error("Use a JPEG, PNG or WebP image.");
  if (file.size > MAX_INPUT_BYTES) throw new Error("That image is too large. Pick one under 15 MB.");
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.fillStyle = "#fff"; // transparent PNGs become white instead of black
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.85));
    if (!blob) return file;
    return new File([blob], "photo.jpg", { type: "image/jpeg" });
  } catch {
    if (file.size > 2 * 1024 * 1024) throw new Error("Could not process that image. Try another one.");
    return file; // small enough to send as it is
  }
}
