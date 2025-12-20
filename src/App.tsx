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
    // Start Foreground Service on app startup (Android only) - sin delay
    if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
      backgroundService.enable()
        .then(() => {
          logger.info('Foreground Service started successfully', 'App');
        })
        .catch((error) => {
          logger.error('Error starting Foreground Service on app startup', 'App', error instanceof Error ? error : new Error(String(error)));
        });
    }

    // Listener for app background/foreground state changes
    if (Capacitor.isNativePlatform()) {
      const handleAppStateChange = async (state: { isActive: boolean }) => {
        if (state.isActive) {
          logger.info('App moved to foreground', 'App');
        } else {
          logger.info('App moved to background - maintaining BLE connection', 'App');
          
          // Ensure background service is active
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

      return () => {
        App.removeAllListeners();
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
