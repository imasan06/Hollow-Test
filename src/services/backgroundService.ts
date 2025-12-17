import { Capacitor } from '@capacitor/core';
import { logger } from '@/utils/logger';

class BackgroundService {
  private isEnabled = false;
  private wakeLock: WakeLockSentinel | null = null;
  private visibilityHandler: (() => void) | null = null;

  constructor() {
    if (Capacitor.isNativePlatform()) {
      logger.debug('Running on native platform, background mode relies on native capabilities.', 'BackgroundService');
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
    this.isEnabled = true;
    logger.info('Background mode enabled. App will attempt to stay alive.', 'BackgroundService');

    if (!Capacitor.isNativePlatform()) {
      await this.keepAlive();
    }
  }

  async disable(): Promise<void> {
    if (!this.isEnabled) {
      logger.debug('Background mode already disabled', 'BackgroundService');
      return;
    }
    this.isEnabled = false;
    logger.info('Background mode disabled.', 'BackgroundService');

    if (this.wakeLock) {
      await this.wakeLock.release();
      this.wakeLock = null;
      logger.debug('Wake lock released', 'BackgroundService');
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
        logger.warn('Failed to acquire wake lock', 'BackgroundService', error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  getIsEnabled(): boolean {
    return this.isEnabled;
  }
}

export const backgroundService = new BackgroundService();

