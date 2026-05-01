import "server-only";

export function isContentLengthTooLarge(request: Request, maxBytes: number) {
  const raw = request.headers.get("content-length");
  if (!raw) {
    return false;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > maxBytes;
}
