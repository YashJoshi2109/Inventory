async function tryShareFile(file: File, title: string): Promise<boolean> {
  try {
    if (!navigator.share || !("canShare" in navigator)) return false;
    const canShare = (navigator as Navigator & { canShare?: (data: ShareData) => boolean }).canShare;
    if (!canShare || !canShare({ files: [file] })) return false;
    await navigator.share({ title, files: [file] });
    return true;
  } catch {
    return false;
  }
}

export async function saveBlob(blob: Blob, filename: string): Promise<void> {
  const file = new File([blob], filename, { type: blob.type || "application/octet-stream" });

  // Best UX on mobile if supported (native share sheet / save).
  const shared = await tryShareFile(file, filename);
  if (shared) return;

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener noreferrer";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function openOrDownloadBlob(blob: Blob, filename: string): Promise<void> {
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank", "noopener,noreferrer");
  if (!win) {
    URL.revokeObjectURL(url);
    await saveBlob(blob, filename);
    return;
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function openOrDownloadDataUrl(dataUrl: string, filename: string): Promise<void> {
  try {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    await openOrDownloadBlob(blob, filename);
  } catch {
    // Last fallback for very old browsers.
    const win = window.open(dataUrl, "_blank", "noopener,noreferrer");
    if (!win) {
      throw new Error("Could not open or download file");
    }
  }
}
