const STORAGE_KEY = "drawrace-player-uuid";

export function getPlayerUuid(): string {
  let uuid = localStorage.getItem(STORAGE_KEY);
  if (!uuid) {
    uuid = crypto.randomUUID();
    localStorage.setItem(STORAGE_KEY, uuid);
  }
  return uuid;
}
