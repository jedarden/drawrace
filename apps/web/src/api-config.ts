const API_URL = import.meta.env.VITE_API_URL ?? "";

export function getApiUrl(): string {
  return API_URL;
}

export function isOnline(): boolean {
  return API_URL.length > 0;
}
