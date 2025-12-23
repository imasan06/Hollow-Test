interface BleEventData {
  name: string;
  value?: boolean;
  error?: string;
  data?: string;
}

export class BackgroundServiceWeb {
  async startService(): Promise<{ success: boolean }> {
    return { success: false };
  }

  async stopService(): Promise<{ success: boolean }> {
    return { success: false };
  }

  async connectBleDevice(): Promise<{ success: boolean }> {
    return { success: false };
  }

  async disconnectBleDevice(): Promise<{ success: boolean }> {
    return { success: false };
  }

  async isBleConnected(): Promise<{ connected: boolean }> {
    return { connected: false };
  }

  async addListener(
    _eventName: "bleConnectionStateChanged" | "bleAudioData" | "bleError",
    _listenerFunc: (data: BleEventData) => void
  ): Promise<{ remove: () => Promise<void> }> {
    // Web implementation - no-op since background service is Android-only
    return {
      remove: async () => {
        // No-op
      }
    };
  }

  async removeAllListeners(): Promise<void> {
    // No-op for web
  }

  async testAudioFlow(): Promise<{ success: boolean; audioSize: number; base64Size: number }> {
    console.log("[BackgroundService.web] testAudioFlow not available on web");
    return { success: false, audioSize: 0, base64Size: 0 };
  }
}
