// Web implementation for BackgroundService plugin
export class BackgroundServiceWeb {
  async startService(): Promise<{ success: boolean }> {
    // Web doesn't support foreground services
    return { success: false };
  }

  async stopService(): Promise<{ success: boolean }> {
    // Web doesn't support foreground services
    return { success: false };
  }
}








