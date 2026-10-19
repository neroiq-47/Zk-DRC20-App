// Web build (browser preview): the keychain isn't available, so fall back to localStorage.
function ls(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export const storage = {
  get: async (key: string) => ls()?.getItem(key) ?? null,
  set: async (key: string, value: string) => {
    ls()?.setItem(key, value);
  },
  remove: async (key: string) => {
    ls()?.removeItem(key);
  },
};
