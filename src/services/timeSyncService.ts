/**
 * Time Synchronization Service
 * 
 * Handles periodic time sync with the watch (every 60 seconds)
 * and responds to REQ_TIME requests from the watch.
 * 
 * This service is separate from AI response handling to prevent
 * time messages from appearing as AI answers.
 */

import { bleManager } from '@/ble/bleManager';

class TimeSyncService {
  private intervalId: NodeJS.Timeout | null = null;
  private isActive = false;
  private readonly SYNC_INTERVAL_MS = 60000; // 60 seconds

  /**
   * Start periodic time synchronization
   * Sends time every 60 seconds while connected
   */
  start(): void {
    if (this.isActive) {
      console.warn('[TimeSync] Already active, ignoring start()');
      return;
    }

    if (!bleManager.isConnected()) {
      console.warn('[TimeSync] Cannot start - not connected to device');
      return;
    }

    this.isActive = true;
    console.log('[TimeSync] Starting periodic time sync (60s interval)');

    // Send immediately on start
    this.sendTimeNow();

    // Then send every 60 seconds
    this.intervalId = setInterval(() => {
      if (bleManager.isConnected()) {
        this.sendTimeNow();
      } else {
        console.warn('[TimeSync] Device disconnected, stopping sync');
        this.stop();
      }
    }, this.SYNC_INTERVAL_MS);
  }

  /**
   * Stop periodic time synchronization
   */
  stop(): void {
    if (!this.isActive) {
      return;
    }

    this.isActive = false;
    
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('[TimeSync] Stopped periodic time sync');
    }
  }

  /**
   * Send time immediately (used for REQ_TIME responses and initial sync)
   */
  async sendTimeNow(): Promise<void> {
    if (!bleManager.isConnected()) {
      console.warn('[TimeSync] Cannot send time - not connected');
      return;
    }

    try {
      await bleManager.sendTime();
      console.log('[TimeSync] Time sent successfully');
    } catch (error) {
      console.error('[TimeSync] Failed to send time:', error);
    }
  }

  /**
   * Handle REQ_TIME request from watch
   * Called when watch requests time via control message
   */
  async handleTimeRequest(): Promise<void> {
    console.log('[TimeSync] Watch requested time (REQ_TIME)');
    await this.sendTimeNow();
  }

  /**
   * Check if service is active
   */
  isRunning(): boolean {
    return this.isActive;
  }
}

// Singleton instance
export const timeSyncService = new TimeSyncService();

