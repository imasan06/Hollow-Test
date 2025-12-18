import { useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import { Settings } from "./pages/Settings";
import { backgroundService } from "./services/backgroundService";
import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { logger } from "./utils/logger";

const queryClient = new QueryClient();

const AppComponent = () => {
  useEffect(() => {
    console.log('🔵 App.tsx useEffect ejecutado');
    console.log('🔵 Capacitor.isNativePlatform():', Capacitor.isNativePlatform());
    console.log('🔵 Capacitor.getPlatform():', Capacitor.getPlatform());
    
    // Iniciar el Foreground Service al arrancar la app (solo en Android)
    if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
      console.log('🚀 App iniciada en Android, iniciando Foreground Service...');
      logger.info('🚀 App iniciada, iniciando Foreground Service...', 'App');
      
      backgroundService.enable()
        .then(() => {
          console.log('✅ Foreground Service iniciado exitosamente desde App.tsx');
        })
        .catch((error) => {
          console.error('❌ Error al iniciar Foreground Service desde App.tsx:', error);
          logger.error('Error al iniciar Foreground Service al arrancar la app', 'App', error instanceof Error ? error : new Error(String(error)));
        });
    } else {
      console.log('ℹ️ App iniciada en plataforma no-Android, no se inicia Foreground Service');
      logger.debug('App iniciada en plataforma no-Android, no se inicia Foreground Service', 'App');
    }

    // Listener para cuando la app va a segundo plano
    if (Capacitor.isNativePlatform()) {
      const handleAppStateChange = async (state: { isActive: boolean }) => {
        if (state.isActive) {
          logger.info('App moved to foreground', 'App');
          console.log('🔵 App moved to foreground');
        } else {
          logger.info('App moved to background - maintaining BLE connection', 'App');
          console.log('🔵 App moved to background - maintaining BLE connection');
          
          // Asegurar que el servicio en segundo plano esté activo
          if (Capacitor.getPlatform() === 'android') {
            try {
              if (!backgroundService.getIsEnabled()) {
                await backgroundService.enable();
                logger.info('Background service enabled when app went to background', 'App');
              }
            } catch (error) {
              logger.error('Failed to enable background service when going to background', 'App', error instanceof Error ? error : new Error(String(error)));
            }
          }
        }
      };

      App.addListener('appStateChange', handleAppStateChange);
      logger.debug('App state change listener registered', 'App');

      return () => {
        App.removeAllListeners();
        logger.debug('App state change listeners removed', 'App');
      };
    }
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default AppComponent;
