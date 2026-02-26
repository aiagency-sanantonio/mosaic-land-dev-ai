import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { ChatSidebar } from '@/components/chat/ChatSidebar';
import { ChatMessage } from '@/components/chat/ChatMessage';
import { ChatInput } from '@/components/chat/ChatInput';
import { EmptyState } from '@/components/chat/EmptyState';
import { useAuth } from '@/hooks/useAuth';
import { useChatThreads } from '@/hooks/useChatThreads';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

export default function Chat() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  

  const {
    threads,
    currentThreadId,
    messages,
    loading: threadsLoading,
    sendingMessage,
    setCurrentThreadId,
    createThread,
    deleteThread,
    sendMessage,
  } = useChatThreads();

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth');
    }
  }, [user, authLoading, navigate]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);


  const handleSendMessage = (content: string) => {
    // Pass 'edge-function' as a signal to use the edge function
    sendMessage(content, 'edge-function');
  };

  if (authLoading || threadsLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <ChatSidebar
          threads={threads}
          currentThreadId={currentThreadId}
          onSelectThread={setCurrentThreadId}
          onNewThread={() => {
            setCurrentThreadId(null);
          }}
          onDeleteThread={deleteThread}
        />

        <main className="flex-1 flex flex-col min-h-screen">
          {/* Header */}
          <header className="h-14 border-b border-border flex items-center px-4 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="flex items-center gap-2">
              <SidebarTrigger />
              <span className="text-sm text-muted-foreground">
                {currentThreadId
                  ? threads.find((t) => t.id === currentThreadId)?.title || 'Chat'
                  : 'New Chat'}
              </span>
            </div>
          </header>

          {/* Messages area */}
          <div className="flex-1 overflow-y-auto">
            {messages.length === 0 ? (
              <EmptyState />
            ) : (
              <div className="p-4 space-y-4 pb-8">
                {messages.map((message, index) => (
                  <ChatMessage
                    key={message.id}
                    role={message.role}
                    content={message.content}
                    isNew={index === messages.length - 1}
                  />
                ))}
                {sendingMessage && (
                  <div className="flex gap-3 max-w-4xl mx-auto">
                    <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center">
                      <Loader2 className="h-4 w-4 animate-spin" />
                    </div>
                    <div className="chat-bubble-assistant">
                      <div className="flex gap-1">
                        <span className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-pulse-subtle" />
                        <span className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-pulse-subtle" style={{ animationDelay: '0.2s' }} />
                        <span className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-pulse-subtle" style={{ animationDelay: '0.4s' }} />
                      </div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* Input area */}
          <div className="p-4 bg-gradient-to-t from-background via-background to-transparent">
            <ChatInput
              onSend={handleSendMessage}
              isLoading={sendingMessage}
            />
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}
