/**
 * BLE Bootstrap - Pre-inicializa el BLE lo más temprano posible
 * Este módulo se importa en main.tsx antes de montar React
 */
import { BleClient } from '@capacitor-community/bluetooth-le';
import { Capacitor } from '@capacitor/core';
import { APP_CONFIG } from '@/config/app.config';

// Promise que se resuelve cuando BLE está listo
let bleReadyPromise: Promise<void> | null = null;
let isReady = false;

/**
 * Pre-inicializa BleClient de forma asíncrona
 * Se llama inmediatamente al importar el módulo
 */
export function preInitializeBle(): Promise<void> {
  // Si ya está inicializado, retornar inmediatamente
  if (isReady) {
    return Promise.resolve();
  }

  // Si ya hay una inicialización en progreso, retornar esa promesa
  if (bleReadyPromise) {
    return bleReadyPromise;
  }

  // No pre-inicializar en modo mock o web
  if (APP_CONFIG.BLE_MOCK_MODE || !Capacitor.isNativePlatform()) {
    isReady = true;
    return Promise.resolve();
  }

  // Inicializar BleClient de forma asíncrona
  bleReadyPromise = BleClient.initialize()
    .then(() => {
      isReady = true;
      if (import.meta.env.DEV) {
        console.log('[BLE Bootstrap] Pre-initialized successfully');
      }
    })
    .catch((error) => {
      // No bloquear el startup si falla, el bleManager lo intentará de nuevo
      if (import.meta.env.DEV) {
        console.warn('[BLE Bootstrap] Pre-initialization failed, will retry later:', error);
      }
      isReady = false;
      bleReadyPromise = null;
    });

  return bleReadyPromise;
}

/**
 * Verifica si BLE ya está pre-inicializado
 */
export function isBlePreInitialized(): boolean {
  return isReady;
}

/**
 * Espera a que BLE esté listo (si hay pre-inicialización en progreso)
 */
export function waitForBleReady(): Promise<void> {
  if (isReady) {
    return Promise.resolve();
  }
  if (bleReadyPromise) {
    return bleReadyPromise;
  }
  return Promise.resolve();
}

// Iniciar pre-inicialización inmediatamente al importar este módulo
preInitializeBle();


