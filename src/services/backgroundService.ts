import { Capacitor } from '@capacitor/core';
import { registerPlugin } from '@capacitor/core';
import { logger } from '@/utils/logger';

interface BackgroundServicePlugin {
  startService(): Promise<{ success: boolean }>;
  stopService(): Promise<{ success: boolean }>;
}

// Registrar el plugin usando la API de Capacitor 7
const BackgroundServiceNative = registerPlugin<BackgroundServicePlugin>('BackgroundService', {
  web: () => import('./backgroundService.web').then(m => new m.BackgroundServiceWeb()),
});

// Verificar que el plugin está disponible
console.log('🔵 BackgroundServiceNative plugin registered:', BackgroundServiceNative ? 'yes' : 'no');
logger.debug(`BackgroundServiceNative plugin registered: ${BackgroundServiceNative ? 'yes' : 'no'}`, 'BackgroundService');

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
    console.log('🔵 BackgroundService.enable() llamado');
    console.log('🔵 isEnabled actual:', this.isEnabled);
    
    if (this.isEnabled) {
      console.log('⚠️ Background mode already enabled');
      logger.debug('Background mode already enabled', 'BackgroundService');
      return;
    }

    console.log(`🔵 Platform check: isNative=${Capacitor.isNativePlatform()}, platform=${Capacitor.getPlatform()}`);
    logger.info(`Platform check: isNative=${Capacitor.isNativePlatform()}, platform=${Capacitor.getPlatform()}`, 'BackgroundService');

    try {
      if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
        console.log('🔵 Android platform detected, attempting to start BackgroundService plugin...');
        logger.info('Android platform detected, attempting to start BackgroundService plugin...', 'BackgroundService');
        
        console.log(`🔵 BackgroundServiceNative available: ${BackgroundServiceNative ? 'yes' : 'no'}`);
        console.log(`🔵 BackgroundServiceNative type: ${typeof BackgroundServiceNative}`);
        console.log(`🔵 BackgroundServiceNative methods: ${BackgroundServiceNative && typeof BackgroundServiceNative === 'object' ? Object.keys(BackgroundServiceNative).join(', ') : 'N/A'}`);
        
        logger.debug(`BackgroundServiceNative available: ${BackgroundServiceNative ? 'yes' : 'no'}`, 'BackgroundService');
        logger.debug(`BackgroundServiceNative type: ${typeof BackgroundServiceNative}`, 'BackgroundService');
        logger.debug(`BackgroundServiceNative methods: ${BackgroundServiceNative && typeof BackgroundServiceNative === 'object' ? Object.keys(BackgroundServiceNative).join(', ') : 'N/A'}`, 'BackgroundService');
        
        // Verificar que el método startService existe
        if (!BackgroundServiceNative || typeof BackgroundServiceNative.startService !== 'function') {
          console.error('❌ BackgroundServiceNative.startService is not available! Plugin may not be registered correctly.');
          logger.error('❌ BackgroundServiceNative.startService is not available! Plugin may not be registered correctly.', 'BackgroundService');
          throw new Error('BackgroundService plugin not available. Make sure the plugin is properly registered in MainActivity.');
        }
        
        try {
          console.log('🔵 Calling BackgroundServiceNative.startService()...');
          logger.debug('Calling BackgroundServiceNative.startService()...', 'BackgroundService');
          const result = await BackgroundServiceNative.startService();
          console.log(`🔵 BackgroundServiceNative.startService() result:`, result);
          logger.debug(`BackgroundServiceNative.startService() result: ${JSON.stringify(result)}`, 'BackgroundService');
          
          if (result && result.success) {
            console.log('✅ Native foreground service started successfully');
            logger.info('✅ Native foreground service started successfully', 'BackgroundService');
          } else {
            console.warn(`⚠️ Foreground service start returned:`, result);
            logger.warn(`⚠️ Foreground service start returned: ${JSON.stringify(result)}`, 'BackgroundService');
          }
        } catch (serviceError) {
          const errorMsg = serviceError instanceof Error ? serviceError.message : String(serviceError);
          console.error(`❌ Failed to start foreground service:`, serviceError);
          console.error(`❌ Error message: ${errorMsg}`);
          logger.error(`❌ Failed to start foreground service: ${errorMsg}`, 'BackgroundService', serviceError instanceof Error ? serviceError : new Error(String(serviceError)));
          logger.error(`Error details: ${JSON.stringify(serviceError)}`, 'BackgroundService');
          logger.error(`Error stack: ${serviceError instanceof Error ? serviceError.stack : 'N/A'}`, 'BackgroundService');
          
          // Intentar de nuevo después de un breve delay
          setTimeout(async () => {
            try {
              logger.info('Retrying to start BackgroundService after 1 second...', 'BackgroundService');
              const retryResult = await BackgroundServiceNative.startService();
              if (retryResult && retryResult.success) {
                logger.info('✅ Foreground service started on retry', 'BackgroundService');
              } else {
                logger.warn(`⚠️ Foreground service retry returned: ${JSON.stringify(retryResult)}`, 'BackgroundService');
              }
            } catch (retryError) {
              const retryErrorMsg = retryError instanceof Error ? retryError.message : String(retryError);
              logger.error(`❌ Foreground service retry failed: ${retryErrorMsg}`, 'BackgroundService', retryError instanceof Error ? retryError : new Error(String(retryError)));
            }
          }, 1000);
        }
      } else if (!Capacitor.isNativePlatform()) {
        logger.info('Web platform detected, using wake lock', 'BackgroundService');
        await this.keepAlive();
      } else {
        logger.warn(`Platform ${Capacitor.getPlatform()} not supported for foreground service`, 'BackgroundService');
      }

      this.isEnabled = true;
      logger.info('Background mode enabled. App will attempt to stay alive.', 'BackgroundService');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`❌ Failed to enable background mode: ${errorMsg}`, 'BackgroundService', error instanceof Error ? error : new Error(String(error)));
      this.isEnabled = true;
      logger.warn('⚠️ Continuing without foreground service - BLE plugin may handle background', 'BackgroundService');
    }
  }

  async disable(): Promise<void> {
    if (!this.isEnabled) {
      logger.debug('Background mode already disabled', 'BackgroundService');
      return;
    }

    try {
      if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
        try {
          await BackgroundServiceNative.stopService();
          logger.info('Native foreground service stopped', 'BackgroundService');
        } catch (serviceError) {
          logger.warn('Failed to stop foreground service', 'BackgroundService');
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

