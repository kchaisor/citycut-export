export const COM_BUILDING_HEIGHTS_STORAGE_KEY = "citycut.comBuildingHeights";

export type KeyValueStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export function readStoredComBuildingHeights(storage: KeyValueStore): boolean {
  try {
    return storage.getItem(COM_BUILDING_HEIGHTS_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function writeStoredComBuildingHeights(storage: KeyValueStore, enabled: boolean): void {
  try {
    storage.setItem(COM_BUILDING_HEIGHTS_STORAGE_KEY, enabled ? "true" : "false");
  } catch {
    // Private mode can reject localStorage.
  }
}
