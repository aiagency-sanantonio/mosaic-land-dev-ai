import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import Chat from "./pages/Chat";
import Auth from "./pages/Auth";
import AdminIndexing from "./pages/AdminIndexing";
import Settings from "./pages/Settings";
import SharedThread from "./pages/SharedThread";
import WebLinks from "./pages/WebLinks";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <AuthProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Chat />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/admin/indexing" element={<AdminIndexing />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/share/:token" element={<SharedThread />} />
            <Route path="/web-links" element={<WebLinks />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
