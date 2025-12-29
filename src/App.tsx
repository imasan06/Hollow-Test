import { useEffect, useState } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import { Settings } from "./pages/Settings";
import { LicenseScreen } from "./pages/LicenseScreen";
import { backgroundService } from "./services/backgroundService";
import { checkLicenseStatus } from "./services/licenseService";
import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { logger } from "./utils/logger";
import { getBackendSharedToken } from "./api";
import { getActivePreset } from "./storage/settingsStore";
import { Loader2 } from "lucide-react";

const queryClient = new QueryClient();

const AppComponent = () => {
  const [licenseState, setLicenseState] = useState<'checking' | 'valid' | 'invalid'>('checking');

  // Check license on app startup
  useEffect(() => {
    const checkLicense = async () => {
      try {
        logger.info('Checking license status...', 'App');
        const isValid = await checkLicenseStatus();
        setLicenseState(isValid ? 'valid' : 'invalid');
        logger.info(`License status: ${isValid ? 'valid' : 'invalid'}`, 'App');
      } catch (error) {
        logger.error('Error checking license', 'App', error instanceof Error ? error : new Error(String(error)));
        setLicenseState('invalid');
      }
    };

    checkLicense();
  }, []);

  useEffect(() => {
    // Only start services if license is valid
    if (licenseState !== 'valid') return;

    // Start Foreground Service on app startup (Android only)
    if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
      // Configure backend token and preset for native processing
      Promise.all([
        getBackendSharedToken(),
        getActivePreset()
      ]).then(([token, preset]) => {
        if (token) {
          backgroundService.setBackendConfig({
            backendToken: token,
            persona: preset.persona || '',
            rules: preset.rules || '',
            baseRules: preset.baseRules || ''
          }).catch((error) => {
            logger.warn('Failed to set backend config: ' + (error instanceof Error ? error.message : String(error)), 'App');
          });
        }
      }).catch((error) => {
        logger.warn('Failed to get backend config: ' + (error instanceof Error ? error.message : String(error)), 'App');
      });

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

          // Cancel any pending API requests when going to background
          if (typeof window !== 'undefined') {
            const w = window as any;
            if (w.cancelAllRequests) {
              w.cancelAllRequests();
              logger.debug('Cancelled pending API requests on background', 'App');
            }
          }

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
  }, [licenseState]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined') {
        const w = window as any;
        if (w.cancelAllRequests) {
          w.cancelAllRequests();
          logger.debug('Cancelled all requests on app unmount', 'App');
        }
      }
    };
  }, []);

  const handleLicenseActivated = () => {
    setLicenseState('valid');
  };

  // Loading screen while checking license
  if (licenseState === 'checking') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-10 h-10 text-primary animate-spin" />
          <p className="text-muted-foreground">Checking license...</p>
        </div>
      </div>
    );
  }

  // License screen if not licensed
  if (licenseState === 'invalid') {
    return (
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <LicenseScreen onLicenseActivated={handleLicenseActivated} />
        </TooltipProvider>
      </QueryClientProvider>
    );
  }

  // Main app if licensed
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