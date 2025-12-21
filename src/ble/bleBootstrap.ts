import { BleClient } from "@capacitor-community/bluetooth-le";
import { Capacitor } from "@capacitor/core";
import { APP_CONFIG } from "@/config/app.config";

let bleReadyPromise: Promise<void> | null = null;
let isReady = false;

export function preInitializeBle(): Promise<void> {
  if (isReady) {
    return Promise.resolve();
  }

  if (bleReadyPromise) {
    return bleReadyPromise;
  }

  if (APP_CONFIG.BLE_MOCK_MODE || !Capacitor.isNativePlatform()) {
    isReady = true;
    return Promise.resolve();
  }

  bleReadyPromise = BleClient.initialize()
    .then(() => {
      isReady = true;
      if (import.meta.env.DEV) {
        console.log("[BLE Bootstrap] Pre-initialized successfully");
      }
    })
    .catch((error) => {
      if (import.meta.env.DEV) {
        console.warn(
          "[BLE Bootstrap] Pre-initialization failed, will retry later:",
          error
        );
      }
      isReady = false;
      bleReadyPromise = null;
    });

  return bleReadyPromise;
}

export function isBlePreInitialized(): boolean {
  return isReady;
}

export function waitForBleReady(): Promise<void> {
  if (isReady) {
    return Promise.resolve();
  }
  if (bleReadyPromise) {
    return bleReadyPromise;
  }
  return Promise.resolve();
}

preInitializeBle();
