import imageCompression from "browser-image-compression";

/** On-phone compression before anything is stored or uploaded (≈1600 px, ≈300 KB). */
export async function compressPhoto(file: File | Blob): Promise<Blob> {
  try {
    const f = file instanceof File ? file : new File([file], "photo.jpg", { type: (file as Blob).type || "image/jpeg" });
    return await imageCompression(f, { maxWidthOrHeight: 1600, maxSizeMB: 0.35, initialQuality: 0.75, fileType: "image/jpeg", useWebWorker: true });
  } catch {
    return file;
  }
}
