import Constants from 'expo-constants';
import { Platform } from 'react-native';

function defaultApiUrl(): string {
  // In development, reach the API on the machine running Metro.
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  if (host) return `http://${host}:4000/api/v1`;
  return Platform.OS === 'android' ? 'http://10.0.2.2:4000/api/v1' : 'http://localhost:4000/api/v1';
}

export const API_BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL || defaultApiUrl()).replace(/\/$/, '');
export const WS_URL = API_BASE_URL.replace(/^http/, 'ws') + '/ws';
