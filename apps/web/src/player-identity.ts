const STORAGE_KEY = "drawrace-player-uuid";

export function generateUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback for non-secure contexts (plain HTTP, file://) where randomUUID is unavailable.
  // getRandomValues is available in all contexts including insecure ones.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function getPlayerUuid(): string {
  let uuid = localStorage.getItem(STORAGE_KEY);
  if (!uuid) {
    uuid = generateUUID();
    localStorage.setItem(STORAGE_KEY, uuid);
  }
  return uuid;
}
