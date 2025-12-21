import { bleManager } from "@/ble/bleManager";
import { logger } from "@/utils/logger";

class TimeSyncService {
  private intervalId: NodeJS.Timeout | null = null;
  private isActive = false;
  private readonly SYNC_INTERVAL_MS = 60000;

  start(): void {
    if (this.isActive) {
      logger.warn("Already active, ignoring start()", "TimeSync");
      return;
    }

    if (!bleManager.isConnected()) {
      logger.warn("Cannot start - not connected to device", "TimeSync");
      return;
    }

    this.isActive = true;
    logger.debug("Starting periodic time sync (60s interval)", "TimeSync");

    this.sendTimeNow();

    this.intervalId = setInterval(() => {
      if (bleManager.isConnected()) {
        this.sendTimeNow();
      } else {
        logger.warn("Device disconnected, stopping sync", "TimeSync");
        this.stop();
      }
    }, this.SYNC_INTERVAL_MS);
  }

  stop(): void {
    if (!this.isActive) {
      return;
    }

    this.isActive = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.debug("Stopped periodic time sync", "TimeSync");
    }
  }

  async sendTimeNow(): Promise<void> {
    if (!bleManager.isConnected()) {
      logger.warn("Cannot send time - not connected", "TimeSync");
      return;
    }

    try {
      await bleManager.sendTime();
      logger.debug("Time sent successfully", "TimeSync");
    } catch (error) {
      logger.error(
        "Failed to send time",
        "TimeSync",
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  async handleTimeRequest(): Promise<void> {
    logger.debug("Watch requested time (REQ_TIME)", "TimeSync");
    await this.sendTimeNow();
  }

  isRunning(): boolean {
    return this.isActive;
  }
}

export const timeSyncService = new TimeSyncService();
