const STORAGE_KEY = "drawrace-player-uuid";

let memoryUuid: string | null = null;
let ephemeral = false;

function detectStorageAvailable(): boolean {
  try {
    const testKey = "__drawrace_storage_test__";
    localStorage.setItem(testKey, "1");
    localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

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
  if (memoryUuid) return memoryUuid;

  if (!detectStorageAvailable()) {
    ephemeral = true;
    memoryUuid = generateUUID();
    return memoryUuid;
  }

  let uuid: string | null;
  try {
    uuid = localStorage.getItem(STORAGE_KEY);
  } catch {
    ephemeral = true;
    memoryUuid = generateUUID();
    return memoryUuid;
  }
  if (!uuid) {
    uuid = generateUUID();
    try {
      localStorage.setItem(STORAGE_KEY, uuid);
    } catch {
      ephemeral = true;
      memoryUuid = uuid;
    }
  }
  return uuid;
}

export function isEphemeral(): boolean {
  // Ensure detection has run
  getPlayerUuid();
  return ephemeral;
}

/** @internal Reset module state for tests */
export function _resetForTesting(): void {
  memoryUuid = null;
  ephemeral = false;
}
