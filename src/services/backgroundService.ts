import { Capacitor } from "@capacitor/core";
import { registerPlugin } from "@capacitor/core";
import { logger } from "@/utils/logger";

interface BleEventData {
  name: string;
  value?: boolean;
  error?: string;
  data?: string;
}

interface BackgroundServicePlugin {
  startService(options?: {
    deviceAddress?: string;
  }): Promise<{ success: boolean }>;
  stopService(): Promise<{ success: boolean }>;
  connectBleDevice(options: {
    deviceAddress: string;
  }): Promise<{ success: boolean }>;
  disconnectBleDevice(): Promise<{ success: boolean }>;
  isBleConnected(): Promise<{ connected: boolean }>;
  addListener(
    eventName: "bleConnectionStateChanged" | "bleAudioData" | "bleError",
    listenerFunc: (data: BleEventData) => void
  ): Promise<{ remove: () => Promise<void> }>;
  removeAllListeners(): Promise<void>;
  /** Test method to simulate BLE audio flow without a real device */
  testAudioFlow(): Promise<{ success: boolean; audioSize: number; base64Size: number }>;
  /** Set backend configuration (token, persona, rules) for native processing */
  setBackendConfig(options: {
    backendToken?: string;
    persona?: string;
    rules?: string;
  }): Promise<{ success: boolean }>;
  /** Process WAV audio natively (for recorded audio) */
  processAudioNative(options: {
    wavBase64: string;
    context?: string; // Optional conversation context
  }): Promise<{ success: boolean }>;
}

const BackgroundServiceNative = registerPlugin<BackgroundServicePlugin>(
  "BackgroundService",
  {
    web: () =>
      import("./backgroundService.web").then(
        (m) => new m.BackgroundServiceWeb()
      ),
  }
);

logger.debug(
  `BackgroundServiceNative plugin registered: ${
    BackgroundServiceNative ? "yes" : "no"
  }`,
  "BackgroundService"
);

// Export the native plugin for direct event listener access
export { BackgroundServiceNative };
export type { BleEventData };

class BackgroundService {
  private isEnabled = false;
  private wakeLock: WakeLockSentinel | null = null;
  private visibilityHandler: (() => void) | null = null;
  private connectedDeviceAddress: string | null = null;

  constructor() {
    if (Capacitor.isNativePlatform()) {
      logger.debug(
        "Running on native platform, using native foreground service.",
        "BackgroundService"
      );
    } else {
      this.visibilityHandler = this.handleVisibilityChange.bind(this);
      document.addEventListener("visibilitychange", this.visibilityHandler);
      logger.debug(
        "Added visibilitychange listener for web platform",
        "BackgroundService"
      );
    }
  }

  private handleVisibilityChange = async () => {
    if (document.visibilityState === "hidden") {
      logger.debug("App moved to background (web)", "BackgroundService");
      if (this.isEnabled) {
        await this.keepAlive();
      }
    } else {
      logger.debug("App moved to foreground (web)", "BackgroundService");
      if (this.wakeLock) {
        await this.wakeLock.release();
        this.wakeLock = null;
        logger.debug(
          "Wake lock released on foreground (web)",
          "BackgroundService"
        );
      }
    }
  };

  async enable(): Promise<void> {
    if (this.isEnabled) {
      logger.debug("Background mode already enabled", "BackgroundService");
      return;
    }

    logger.info(
      `Platform check: isNative=${Capacitor.isNativePlatform()}, platform=${Capacitor.getPlatform()}`,
      "BackgroundService"
    );

    try {
      if (
        Capacitor.isNativePlatform() &&
        Capacitor.getPlatform() === "android"
      ) {
        logger.info(
          "Android platform detected, attempting to start BackgroundService plugin...",
          "BackgroundService"
        );

        logger.debug(
          `BackgroundServiceNative available: ${
            BackgroundServiceNative ? "yes" : "no"
          }`,
          "BackgroundService"
        );

        if (
          !BackgroundServiceNative ||
          typeof BackgroundServiceNative.startService !== "function"
        ) {
          logger.error(
            "BackgroundServiceNative.startService is not available! Plugin may not be registered correctly.",
            "BackgroundService"
          );
          throw new Error(
            "BackgroundService plugin not available. Make sure the plugin is properly registered in MainActivity."
          );
        }

        try {
          logger.debug(
            "Calling BackgroundServiceNative.startService()...",
            "BackgroundService"
          );

          const options = this.connectedDeviceAddress
            ? { deviceAddress: this.connectedDeviceAddress }
            : undefined;

          const result = await BackgroundServiceNative.startService(options);
          logger.debug(
            `BackgroundServiceNative.startService() result: ${JSON.stringify(
              result
            )}`,
            "BackgroundService"
          );

          if (result && result.success) {
            logger.info(
              "Native foreground service started successfully",
              "BackgroundService"
            );
          } else {
            logger.warn(
              `Foreground service start returned: ${JSON.stringify(result)}`,
              "BackgroundService"
            );
          }
        } catch (serviceError) {
          const errorMsg =
            serviceError instanceof Error
              ? serviceError.message
              : String(serviceError);
          logger.error(
            `Failed to start foreground service: ${errorMsg}`,
            "BackgroundService",
            serviceError instanceof Error
              ? serviceError
              : new Error(String(serviceError))
          );

          setTimeout(async () => {
            try {
              logger.info(
                "Retrying to start BackgroundService after 1 second...",
                "BackgroundService"
              );
              const retryResult = await BackgroundServiceNative.startService();
              if (retryResult && retryResult.success) {
                logger.info(
                  "Foreground service started on retry",
                  "BackgroundService"
                );
              } else {
                logger.warn(
                  `Foreground service retry returned: ${JSON.stringify(
                    retryResult
                  )}`,
                  "BackgroundService"
                );
              }
            } catch (retryError) {
              const retryErrorMsg =
                retryError instanceof Error
                  ? retryError.message
                  : String(retryError);
              logger.error(
                `Foreground service retry failed: ${retryErrorMsg}`,
                "BackgroundService",
                retryError instanceof Error
                  ? retryError
                  : new Error(String(retryError))
              );
            }
          }, 1000);
        }
      } else if (!Capacitor.isNativePlatform()) {
        logger.info(
          "Web platform detected, using wake lock",
          "BackgroundService"
        );
        await this.keepAlive();
      } else {
        logger.warn(
          `Platform ${Capacitor.getPlatform()} not supported for foreground service`,
          "BackgroundService"
        );
      }

      this.isEnabled = true;
      logger.info(
        "Background mode enabled. App will attempt to stay alive.",
        "BackgroundService"
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(
        `❌ Failed to enable background mode: ${errorMsg}`,
        "BackgroundService",
        error instanceof Error ? error : new Error(String(error))
      );
      this.isEnabled = true;
      logger.warn(
        "⚠️ Continuing without foreground service - BLE plugin may handle background",
        "BackgroundService"
      );
    }
  }

  async disable(): Promise<void> {
    if (!this.isEnabled) {
      logger.debug("Background mode already disabled", "BackgroundService");
      return;
    }

    try {
      if (
        Capacitor.isNativePlatform() &&
        Capacitor.getPlatform() === "android"
      ) {
        try {
          await BackgroundServiceNative.stopService();
          logger.info("Native foreground service stopped", "BackgroundService");
        } catch (serviceError) {
          logger.warn("Failed to stop foreground service", "BackgroundService");
        }
      }

      if (this.wakeLock) {
        await this.wakeLock.release();
        this.wakeLock = null;
        logger.debug("Wake lock released", "BackgroundService");
      }

      this.isEnabled = false;
      logger.info("Background mode disabled.", "BackgroundService");
    } catch (error) {
      logger.error(
        "Failed to disable background mode",
        "BackgroundService",
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  private async keepAlive(): Promise<void> {
    if ("wakeLock" in navigator && !this.wakeLock) {
      try {
        this.wakeLock = await (navigator as any).wakeLock.request("screen");
        logger.debug("Wake lock acquired", "BackgroundService");
        this.wakeLock.addEventListener("release", () => {
          logger.debug(
            "Wake lock released by system or user",
            "BackgroundService"
          );
          this.wakeLock = null;
        });
      } catch (error) {
        logger.warn("Failed to acquire wake lock", "BackgroundService");
      }
    }
  }

  async connectBleDevice(deviceAddress: string): Promise<void> {
    this.connectedDeviceAddress = deviceAddress;
    logger.info(
      `Connecting BLE device to background service: ${deviceAddress}`,
      "BackgroundService"
    );

    if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android") {
      try {
        if (
          BackgroundServiceNative &&
          typeof BackgroundServiceNative.connectBleDevice === "function"
        ) {
          await BackgroundServiceNative.connectBleDevice({ deviceAddress });
          logger.info(
            "BLE device connected to background service",
            "BackgroundService"
          );
        } else {
          logger.warn(
            "connectBleDevice method not available, using startService with device address",
            "BackgroundService"
          );

          await BackgroundServiceNative.startService({ deviceAddress });
        }
      } catch (error) {
        logger.error(
          "Failed to connect BLE device to background service",
          "BackgroundService",
          error instanceof Error ? error : new Error(String(error))
        );
      }
    }
  }

  async disconnectBleDevice(): Promise<void> {
    logger.info(
      "Disconnecting BLE device from background service",
      "BackgroundService"
    );
    this.connectedDeviceAddress = null;

    if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android") {
      try {
        if (
          BackgroundServiceNative &&
          typeof BackgroundServiceNative.disconnectBleDevice === "function"
        ) {
          await BackgroundServiceNative.disconnectBleDevice();
          logger.info(
            "BLE device disconnected from background service",
            "BackgroundService"
          );
        }
      } catch (error) {
        logger.error(
          "Failed to disconnect BLE device from background service",
          "BackgroundService",
          error instanceof Error ? error : new Error(String(error))
        );
      }
    }
  }

  async isBleConnected(): Promise<boolean> {
    if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android") {
      try {
        if (
          BackgroundServiceNative &&
          typeof BackgroundServiceNative.isBleConnected === "function"
        ) {
          const result = await BackgroundServiceNative.isBleConnected();
          return result?.connected || false;
        }
      } catch (error) {
        logger.error(
          "Failed to check BLE connection status",
          "BackgroundService",
          error instanceof Error ? error : new Error(String(error))
        );
      }
    }
    return false;
  }

  getIsEnabled(): boolean {
    return this.isEnabled;
  }

  /**
   * Test method to simulate BLE audio flow without a real device.
   * Useful for testing the BackgroundService → Plugin → JavaScript flow.
   */
  async testAudioFlow(): Promise<{ success: boolean; audioSize?: number; base64Size?: number }> {
    if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android") {
      try {
        if (
          BackgroundServiceNative &&
          typeof BackgroundServiceNative.testAudioFlow === "function"
        ) {
          logger.info("Testing BackgroundService audio flow...", "BackgroundService");
          const result = await BackgroundServiceNative.testAudioFlow();
          logger.info(
            `Test audio sent: ${result.audioSize} bytes (${result.base64Size} base64 chars)`,
            "BackgroundService"
          );
          return result;
        } else {
          logger.warn("testAudioFlow not available", "BackgroundService");
          return { success: false };
        }
      } catch (error) {
        logger.error(
          "Failed to test audio flow",
          "BackgroundService",
          error instanceof Error ? error : new Error(String(error))
        );
        return { success: false };
      }
    }
    logger.warn("testAudioFlow only available on Android", "BackgroundService");
    return { success: false };
  }

  /**
   * Set backend configuration for native audio processing
   * This must be called before native processing can work
   */
  async setBackendConfig(options: {
    backendToken?: string;
    persona?: string;
    rules?: string;
  }): Promise<{ success: boolean }> {
    if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android") {
      try {
        if (
          BackgroundServiceNative &&
          typeof BackgroundServiceNative.setBackendConfig === "function"
        ) {
          const result = await BackgroundServiceNative.setBackendConfig(options);
          logger.debug("Backend config set successfully", "BackgroundService");
          return result;
        } else {
          logger.warn("setBackendConfig not available", "BackgroundService");
          return { success: false };
        }
      } catch (error) {
        logger.error(
          "Failed to set backend config",
          "BackgroundService",
          error instanceof Error ? error : new Error(String(error))
        );
        return { success: false };
      }
    }
    return { success: false };
  }

  /**
   * Process WAV audio natively (for recorded audio)
   */
  async processAudioNative(
    wavBase64: string,
    context?: string
  ): Promise<{ success: boolean }> {
    if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android") {
      try {
        if (
          BackgroundServiceNative &&
          typeof BackgroundServiceNative.processAudioNative === "function"
        ) {
          logger.info("Processing audio natively...", "BackgroundService");
          const result = await BackgroundServiceNative.processAudioNative({
            wavBase64,
            context,
          });
          logger.debug("Native audio processing initiated", "BackgroundService");
          return result;
        } else {
          logger.warn("processAudioNative not available", "BackgroundService");
          return { success: false };
        }
      } catch (error) {
        logger.error(
          "Failed to process audio natively",
          "BackgroundService",
          error instanceof Error ? error : new Error(String(error))
        );
        return { success: false };
      }
    }
    return { success: false };
  }
}

export const backgroundService = new BackgroundService();

// Expose test function globally for debugging (accessible from browser console)
if (typeof window !== "undefined") {
  (window as any).testBackgroundAudio = () => backgroundService.testAudioFlow();
}
