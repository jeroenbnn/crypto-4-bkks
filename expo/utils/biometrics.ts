import { Platform } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';

export type BiometricType = 'face' | 'fingerprint' | 'none';

export interface AuthResult {
  success: boolean;
  error?: string;
}

export async function getSupportedBiometricType(): Promise<BiometricType> {
  if (Platform.OS === 'web') return 'none';
  try {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    if (!hasHardware) return 'none';
    const isEnrolled = await LocalAuthentication.isEnrolledAsync();
    if (!isEnrolled) return 'none';
    const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
    if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) return 'face';
    if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) return 'fingerprint';
    return 'none';
  } catch (e) {
    console.error('[Biometrics] getSupportedBiometricType error:', e);
    return 'none';
  }
}

export async function authenticateWithBiometrics(reason: string): Promise<AuthResult> {
  if (Platform.OS === 'web') {
    return { success: true };
  }
  try {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const isEnrolled = await LocalAuthentication.isEnrolledAsync();

    if (!hasHardware || !isEnrolled) {
      console.log('[Biometrics] No biometrics enrolled, skipping');
      return { success: true };
    }

    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: reason,
      fallbackLabel: 'Use Passcode',
      disableDeviceFallback: false,
      cancelLabel: 'Cancel',
    });

    const errorMsg = result.success ? undefined : (result as { success: false; error: string }).error;
    console.log('[Biometrics] Auth result:', result.success, errorMsg);
    return { success: result.success, error: errorMsg };
  } catch (e) {
    console.error('[Biometrics] authenticateWithBiometrics error:', e);
    return { success: false, error: 'Authentication failed' };
  }
}
