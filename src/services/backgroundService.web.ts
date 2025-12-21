export class BackgroundServiceWeb {
  async startService(): Promise<{ success: boolean }> {
    return { success: false };
  }

  async stopService(): Promise<{ success: boolean }> {
    return { success: false };
  }
}
