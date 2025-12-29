import { Preferences } from '@capacitor/preferences';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { logger } from '@/utils/logger';

const API_ENDPOINT = import.meta.env.VITE_API_ENDPOINT || 'https://hollow-backend.fly.dev';
const LICENSE_CODE_KEY = 'hollow_license_code';
const DEVICE_ID_KEY = 'hollow_device_id';
const LICENSE_STATUS_KEY = 'hollow_license_status';
const LICENSE_CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

interface LicenseStatus {
    valid: boolean;
    expiresAt?: string;
    lastChecked: number;
}

let cachedDeviceId: string | null = null;
let cachedLicenseStatus: LicenseStatus | null = null;

/**
 * Generate or retrieve a unique device ID
 */
export async function getDeviceId(): Promise<string> {
    if (cachedDeviceId) {
        return cachedDeviceId;
    }

    try {
        const { value } = await Preferences.get({ key: DEVICE_ID_KEY });

        if (value) {
            cachedDeviceId = value;
            return value;
        }

        // Generate a new device ID
        const newDeviceId = `device_${Date.now()}_${Math.random().toString(36).substr(2, 9)}_${Math.random().toString(36).substr(2, 9)}`;
        await Preferences.set({ key: DEVICE_ID_KEY, value: newDeviceId });
        cachedDeviceId = newDeviceId;

        logger.info('Generated new device ID', 'License');
        return newDeviceId;
    } catch (error) {
        logger.error('Error getting device ID', 'License', error instanceof Error ? error : new Error(String(error)));
        // Return a temporary ID if storage fails
        return `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
}

/**
 * Get stored license code
 */
export async function getStoredLicenseCode(): Promise<string | null> {
    try {
        const { value } = await Preferences.get({ key: LICENSE_CODE_KEY });
        return value;
    } catch (error) {
        logger.error('Error getting license code', 'License', error instanceof Error ? error : new Error(String(error)));
        return null;
    }
}

/**
 * Store license code locally
 */
async function storeLicenseCode(code: string): Promise<void> {
    await Preferences.set({ key: LICENSE_CODE_KEY, value: code });
}

/**
 * Store license status locally
 */
async function storeLicenseStatus(status: LicenseStatus): Promise<void> {
    await Preferences.set({ key: LICENSE_STATUS_KEY, value: JSON.stringify(status) });
    cachedLicenseStatus = status;
}

/**
 * Get cached license status
 */
async function getCachedLicenseStatus(): Promise<LicenseStatus | null> {
    if (cachedLicenseStatus) {
        return cachedLicenseStatus;
    }

    try {
        const { value } = await Preferences.get({ key: LICENSE_STATUS_KEY });
        if (value) {
            cachedLicenseStatus = JSON.parse(value);
            return cachedLicenseStatus;
        }
    } catch (error) {
        logger.error('Error getting cached license status', 'License', error instanceof Error ? error : new Error(String(error)));
    }
    return null;
}

/**
 * Activate a license code for this device
 */
export async function activateLicense(code: string): Promise<{ success: boolean; error?: string }> {
    try {
        const deviceId = await getDeviceId();
        const normalizedCode = code.toUpperCase().trim();

        logger.info(`Attempting to activate license: ${normalizedCode}`, 'License');

        const url = `${API_ENDPOINT}/v1/license/activate`;
        const payload = {
            code: normalizedCode,
            device_id: deviceId,
        };

        let response;

        if (Capacitor.isNativePlatform()) {
            response = await CapacitorHttp.request({
                method: 'POST',
                url,
                headers: {
                    'Content-Type': 'application/json',
                },
                data: payload,
                connectTimeout: 15000,
                readTimeout: 30000,
            });

            if (response.status >= 400) {
                const errorData = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
                const errorMessage = errorData?.error || errorData?.message || 'Activation failed';
                logger.error(`License activation failed: ${response.status}`, 'License', new Error(errorMessage));
                return { success: false, error: errorMessage };
            }

            const data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;

            if (data.valid) {
                await storeLicenseCode(normalizedCode);
                await storeLicenseStatus({
                    valid: true,
                    expiresAt: data.expires_at,
                    lastChecked: Date.now(),
                });
                logger.info('License activated successfully', 'License');
                return { success: true };
            } else {
                return { success: false, error: data.error || 'Invalid license code' };
            }
        } else {
            // Web fetch fallback
            const fetchResponse = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
            });

            if (!fetchResponse.ok) {
                const errorData = await fetchResponse.json().catch(() => ({}));
                const errorMessage = errorData?.error || errorData?.message || 'Activation failed';
                return { success: false, error: errorMessage };
            }

            const data = await fetchResponse.json();

            if (data.valid) {
                await storeLicenseCode(normalizedCode);
                await storeLicenseStatus({
                    valid: true,
                    expiresAt: data.expires_at,
                    lastChecked: Date.now(),
                });
                logger.info('License activated successfully', 'License');
                return { success: true };
            } else {
                return { success: false, error: data.error || 'Invalid license code' };
            }
        }
    } catch (error) {
        logger.error('License activation error', 'License', error instanceof Error ? error : new Error(String(error)));
        return { success: false, error: 'Network error. Please check your connection and try again.' };
    }
}

/**
 * Check if the current device has a valid license
 * Uses cached status if checked recently, otherwise validates with server
 */
export async function checkLicenseStatus(forceRefresh = false): Promise<boolean> {
    try {
        // Check cached status first
        const cachedStatus = await getCachedLicenseStatus();
        const now = Date.now();

        if (!forceRefresh && cachedStatus && cachedStatus.valid) {
            const timeSinceCheck = now - cachedStatus.lastChecked;

            // If checked within the interval and valid, return true
            if (timeSinceCheck < LICENSE_CHECK_INTERVAL) {
                logger.debug('Using cached license status (valid)', 'License');
                return true;
            }
        }

        // No valid cache, check with server
        const licenseCode = await getStoredLicenseCode();
        if (!licenseCode) {
            logger.debug('No license code stored', 'License');
            return false;
        }

        const deviceId = await getDeviceId();
        const url = `${API_ENDPOINT}/v1/license/status`;

        let data;

        if (Capacitor.isNativePlatform()) {
            const response = await CapacitorHttp.request({
                method: 'GET',
                url,
                headers: {
                    'X-Device-ID': deviceId,
                },
                connectTimeout: 10000,
                readTimeout: 20000,
            });

            if (response.status >= 400) {
                logger.warn('License status check failed, using cached status', 'License');
                return cachedStatus?.valid ?? false;
            }

            data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
        } else {
            const fetchResponse = await fetch(url, {
                method: 'GET',
                headers: {
                    'X-Device-ID': deviceId,
                },
            });

            if (!fetchResponse.ok) {
                logger.warn('License status check failed, using cached status', 'License');
                return cachedStatus?.valid ?? false;
            }

            data = await fetchResponse.json();
        }

        const isValid = data.active === true;

        await storeLicenseStatus({
            valid: isValid,
            expiresAt: data.expires_at,
            lastChecked: now,
        });

        logger.info(`License status: ${isValid ? 'active' : 'inactive'}`, 'License');
        return isValid;
    } catch (error) {
        logger.error('Error checking license status', 'License', error instanceof Error ? error : new Error(String(error)));
        // On network error, use cached status if available
        const cachedStatus = await getCachedLicenseStatus();
        return cachedStatus?.valid ?? false;
    }
}

/**
 * Clear all license data (for debugging/testing)
 */
export async function clearLicenseData(): Promise<void> {
    await Preferences.remove({ key: LICENSE_CODE_KEY });
    await Preferences.remove({ key: LICENSE_STATUS_KEY });
    cachedLicenseStatus = null;
    logger.info('License data cleared', 'License');
}
