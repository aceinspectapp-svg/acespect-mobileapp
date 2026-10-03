/** QR code for an otpauth:// URI, generated in the browser so the secret never leaves it. */
export async function qrDataUrl(text: string): Promise<string> {
  const QR = await import("qrcode");
  return QR.toDataURL(text, { width: 176, margin: 1 });
}
