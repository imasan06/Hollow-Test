import { Capacitor } from '@capacitor/core';
import { logger } from '@/utils/logger';

interface BackgroundServicePlugin {
  startService(): Promise<{ success: boolean }>;
  stopService(): Promise<{ success: boolean }>;
}

declare global {
  interface Window {
    BackgroundService?: BackgroundServicePlugin;
  }
}

class BackgroundService {
  private isEnabled = false;
  private wakeLock: WakeLockSentinel | null = null;
  private visibilityHandler: (() => void) | null = null;

  constructor() {
    if (Capacitor.isNativePlatform()) {
      logger.debug('Running on native platform, using native foreground service.', 'BackgroundService');
    } else {
      this.visibilityHandler = this.handleVisibilityChange.bind(this);
      document.addEventListener('visibilitychange', this.visibilityHandler);
      logger.debug('Added visibilitychange listener for web platform', 'BackgroundService');
    }
  }

  private handleVisibilityChange = async () => {
    if (document.visibilityState === 'hidden') {
      logger.debug('App moved to background (web)', 'BackgroundService');
      if (this.isEnabled) {
        await this.keepAlive();
      }
    } else {
      logger.debug('App moved to foreground (web)', 'BackgroundService');
      if (this.wakeLock) {
        await this.wakeLock.release();
        this.wakeLock = null;
        logger.debug('Wake lock released on foreground (web)', 'BackgroundService');
      }
    }
  };

  async enable(): Promise<void> {
    if (this.isEnabled) {
      logger.debug('Background mode already enabled', 'BackgroundService');
      return;
    }

    try {
      if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
        const Plugins = (Capacitor as any).Plugins;
        if (Plugins && Plugins.BackgroundService) {
          try {
            await Plugins.BackgroundService.startService();
            logger.info('Native foreground service started', 'BackgroundService');
          } catch (serviceError) {
            logger.warn('Failed to start foreground service, BLE plugin will handle background', 'BackgroundService');
          }
        } else {
          logger.warn('BackgroundService plugin not registered, BLE plugin will handle background', 'BackgroundService');
        }
      } else if (!Capacitor.isNativePlatform()) {
        await this.keepAlive();
      }

      this.isEnabled = true;
      logger.info('Background mode enabled. App will attempt to stay alive.', 'BackgroundService');
    } catch (error) {
      logger.error('Failed to enable background mode', 'BackgroundService', error instanceof Error ? error : new Error(String(error)));
      this.isEnabled = true;
      logger.warn('Continuing without foreground service - BLE plugin may handle background', 'BackgroundService');
    }
  }

  async disable(): Promise<void> {
    if (!this.isEnabled) {
      logger.debug('Background mode already disabled', 'BackgroundService');
      return;
    }

    try {
      if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
        const Plugins = (Capacitor as any).Plugins;
        if (Plugins && Plugins.BackgroundService) {
          try {
            await Plugins.BackgroundService.stopService();
            logger.info('Native foreground service stopped', 'BackgroundService');
          } catch (serviceError) {
            logger.warn('Failed to stop foreground service', 'BackgroundService');
          }
        }
      }

      if (this.wakeLock) {
        await this.wakeLock.release();
        this.wakeLock = null;
        logger.debug('Wake lock released', 'BackgroundService');
      }

      this.isEnabled = false;
      logger.info('Background mode disabled.', 'BackgroundService');
    } catch (error) {
      logger.error('Failed to disable background mode', 'BackgroundService', error instanceof Error ? error : new Error(String(error)));
    }
  }

  private async keepAlive(): Promise<void> {
    if ('wakeLock' in navigator && !this.wakeLock) {
      try {
        this.wakeLock = await (navigator as any).wakeLock.request('screen');
        logger.debug('Wake lock acquired', 'BackgroundService');
        this.wakeLock.addEventListener('release', () => {
          logger.debug('Wake lock released by system or user', 'BackgroundService');
          this.wakeLock = null;
        });
      } catch (error) {
        logger.warn('Failed to acquire wake lock', 'BackgroundService');
      }
    }
  }

  getIsEnabled(): boolean {
    return this.isEnabled;
  }
}

export const backgroundService = new BackgroundService();

