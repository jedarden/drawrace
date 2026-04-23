const CLIENT_SHARED_KEY = import.meta.env.VITE_CLIENT_SHARED_KEY ?? "drawrace-dev-key-2026";

export async function computeHmac(blob: ArrayBuffer): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(CLIENT_SHARED_KEY),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const data = blob.byteLength > 0 ? blob : new Uint8Array(0);
  const sig = await crypto.subtle.sign("HMAC", key, data);
  const bytes = new Uint8Array(sig);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
