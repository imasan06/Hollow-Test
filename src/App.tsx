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
import { Capacitor } from "@capacitor/core";
import { logger } from "./utils/logger";

const queryClient = new QueryClient();

const App = () => {
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

export default App;
