import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { Toaster } from "sonner";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster 
          position="bottom-right" 
          richColors 
          toastOptions={{
            style: {
              background: 'linear-gradient(135deg, rgba(10, 10, 20, 0.95) 0%, rgba(20, 20, 40, 0.95) 100%)',
              border: '1px solid rgba(255, 0, 136, 0.5)',
              boxShadow: '0 0 20px rgba(255, 0, 136, 0.3), inset 0 0 10px rgba(0, 0, 0, 0.5)',
              color: '#ff0088',
              fontFamily: 'monospace',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            },
            classNames: {
              error: 'cyber-toast-error',
              success: 'cyber-toast-success',
            },
          }}
        />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/auth" element={<Auth />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
