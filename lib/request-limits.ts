import "server-only";

export class RequestBodyTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`Request body exceeds ${maxBytes} bytes.`);
    this.name = "RequestBodyTooLargeError";
  }
}

export function isContentLengthTooLarge(request: Request, maxBytes: number) {
  const raw = request.headers.get("content-length");
  if (!raw) {
    return false;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > maxBytes;
}

export async function readRequestTextWithLimit(request: Request, maxBytes: number) {
  if (isContentLengthTooLarge(request, maxBytes)) {
    throw new RequestBodyTooLargeError(maxBytes);
  }

  if (!request.body) {
    return "";
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    if (!value) {
      continue;
    }

    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new RequestBodyTooLargeError(maxBytes);
    }

    chunks.push(value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(body);
}

export async function readJsonWithLimit<T = unknown>(request: Request, maxBytes: number): Promise<T | null> {
  const text = await readRequestTextWithLimit(request, maxBytes);
  if (!text.trim()) {
    return null;
  }

  return JSON.parse(text) as T;
}
