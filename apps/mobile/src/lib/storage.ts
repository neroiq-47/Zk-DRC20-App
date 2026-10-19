import * as SecureStore from 'expo-secure-store';

// Key-value storage for tokens and preferences. Native uses the OS keychain/keystore.
export const storage = {
  get: (key: string) => SecureStore.getItemAsync(key),
  set: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  remove: (key: string) => SecureStore.deleteItemAsync(key),
};
