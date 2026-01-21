import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { ChatSidebar } from '@/components/chat/ChatSidebar';
import { ChatMessage } from '@/components/chat/ChatMessage';
import { ChatInput } from '@/components/chat/ChatInput';
import { EmptyState } from '@/components/chat/EmptyState';
import { useAuth } from '@/hooks/useAuth';
import { useChatThreads } from '@/hooks/useChatThreads';
import { Loader2, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function Chat() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [isIndexing, setIsIndexing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState(() => 
    localStorage.getItem('n8n_webhook_url') || ''
  );
  const [indexWebhookUrl, setIndexWebhookUrl] = useState(() =>
    localStorage.getItem('n8n_index_webhook_url') || ''
  );

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

  const handleSaveSettings = () => {
    localStorage.setItem('n8n_webhook_url', webhookUrl);
    localStorage.setItem('n8n_index_webhook_url', indexWebhookUrl);
    setSettingsOpen(false);
    toast.success('Settings saved');
  };

  const handleIndexFiles = async () => {
    if (!indexWebhookUrl) {
      toast.error('Please configure your index webhook URL in settings');
      setSettingsOpen(true);
      return;
    }

    setIsIndexing(true);
    try {
      const response = await fetch(indexWebhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'index',
          userId: user?.id,
        }),
      });

      if (response.ok) {
        toast.success('File indexing started successfully');
      } else {
        toast.error('Failed to start file indexing');
      }
    } catch (error) {
      console.error('Index error:', error);
      toast.error('Failed to connect to indexing service');
    } finally {
      setIsIndexing(false);
    }
  };

  const handleSendMessage = (content: string) => {
    sendMessage(content, webhookUrl || undefined);
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
          onIndexFiles={handleIndexFiles}
          isIndexing={isIndexing}
        />

        <main className="flex-1 flex flex-col min-h-screen">
          {/* Header */}
          <header className="h-14 border-b border-border flex items-center justify-between px-4 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="flex items-center gap-2">
              <SidebarTrigger />
              <span className="text-sm text-muted-foreground">
                {currentThreadId
                  ? threads.find((t) => t.id === currentThreadId)?.title || 'Chat'
                  : 'New Chat'}
              </span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSettingsOpen(true)}
              className="text-muted-foreground hover:text-foreground"
            >
              <Settings className="h-4 w-4" />
            </Button>
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

      {/* Settings Dialog */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Webhook Settings</DialogTitle>
            <DialogDescription>
              Configure your N8N webhook URLs for chat and file indexing.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="webhook-url">Chat Webhook URL</Label>
              <Input
                id="webhook-url"
                placeholder="https://your-n8n-instance.com/webhook/..."
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                This webhook will receive user messages for AI processing.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="index-webhook-url">Index Webhook URL</Label>
              <Input
                id="index-webhook-url"
                placeholder="https://your-n8n-instance.com/webhook/..."
                value={indexWebhookUrl}
                onChange={(e) => setIndexWebhookUrl(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                This webhook will trigger Dropbox file indexing.
              </p>
            </div>
            <Button onClick={handleSaveSettings} className="w-full">
              Save Settings
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </SidebarProvider>
  );
}
