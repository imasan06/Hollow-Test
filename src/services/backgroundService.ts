import { Capacitor } from '@capacitor/core';
import { logger } from '@/utils/logger';

class BackgroundService {
  private isEnabled = false;
  private wakeLock: WakeLockSentinel | null = null;
  private appStateListener: any = null;

  async enable(): Promise<void> {
    if (this.isEnabled) {
      logger.debug('Background mode already enabled', 'Background');
      return;
    }

    try {
      if (Capacitor.isNativePlatform()) {
        if (Capacitor.getPlatform() === 'android') {
          await this.enableAndroid();
        } else if (Capacitor.getPlatform() === 'ios') {
          await this.enableIOS();
        }
      } else {
        await this.enableWeb();
      }

      this.isEnabled = true;
      logger.debug('Background mode enabled', 'Background');

      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', this.handleVisibilityChange.bind(this));
        logger.debug('Visibility change listener added', 'Background');
      }
    } catch (error) {
      logger.error('Failed to enable background mode', 'Background', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  private handleVisibilityChange(): void {
    if (document.hidden) {
      logger.debug('App moved to background', 'Background');
      this.keepAlive();
    } else {
      logger.debug('App moved to foreground', 'Background');
    }
  }

  async disable(): Promise<void> {
    if (!this.isEnabled) {
      return;
    }

    try {
      if (this.wakeLock) {
        await this.wakeLock.release();
        this.wakeLock = null;
      }

      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', this.handleVisibilityChange.bind(this));
        logger.debug('Visibility change listener removed', 'Background');
      }

      this.isEnabled = false;
      logger.debug('Background mode disabled', 'Background');
    } catch (error) {
      logger.error('Failed to disable background mode', 'Background', error instanceof Error ? error : new Error(String(error)));
    }
  }

  private async enableAndroid(): Promise<void> {
    if ('serviceWorker' in navigator) {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js');
        logger.debug('Service worker registered for background', 'Background');
      } catch (error) {
        logger.warn('Service worker registration failed', 'Background');
      }
    }
  }

  private async enableIOS(): Promise<void> {
    logger.debug('iOS background mode enabled via UIBackgroundModes', 'Background');
  }

  private async enableWeb(): Promise<void> {
    if ('wakeLock' in navigator) {
      try {
        this.wakeLock = await (navigator as any).wakeLock.request('screen');
        logger.debug('Wake lock acquired', 'Background');

        this.wakeLock.addEventListener('release', () => {
          logger.debug('Wake lock released', 'Background');
          this.wakeLock = null;
        });
      } catch (error) {
        logger.warn('Wake lock not available', 'Background');
      }
    }
  }

  private async keepAlive(): Promise<void> {
    if (this.wakeLock && this.wakeLock.released === false) {
      return;
    }

    if ('wakeLock' in navigator) {
      try {
        this.wakeLock = await (navigator as any).wakeLock.request('screen');
        logger.debug('Wake lock reacquired', 'Background');
      } catch (error) {
        logger.warn('Failed to reacquire wake lock', 'Background');
      }
    }
  }

  isBackgroundModeEnabled(): boolean {
    return this.isEnabled;
  }
}

export const backgroundService = new BackgroundService();

