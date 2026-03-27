import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { ChatSidebar } from '@/components/chat/ChatSidebar';
import { ChatMessage } from '@/components/chat/ChatMessage';
import { ChatInput } from '@/components/chat/ChatInput';
import { EmptyState } from '@/components/chat/EmptyState';
import { useAuth } from '@/hooks/useAuth';
import { useChatThreads } from '@/hooks/useChatThreads';
import { Loader2, MoreHorizontal, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export default function Chat() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const {
    threads, folders, currentThreadId, messages,
    loading: threadsLoading, sendingMessage,
    setCurrentThreadId, deleteThread, sendMessage,
    createFolder, deleteFolder, renameFolder, moveThreadToFolder,
  } = useChatThreads();

  useEffect(() => {
    if (!authLoading && !user) navigate('/auth');
  }, [user, authLoading, navigate]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = (content: string, file?: File) => {
    sendMessage(content, 'edge-function', file);
  };

  const confirmDeleteChat = () => {
    if (currentThreadId) {
      deleteThread(currentThreadId);
    }
    setDeleteDialogOpen(false);
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
          folders={folders}
          currentThreadId={currentThreadId}
          onSelectThread={setCurrentThreadId}
          onNewThread={() => setCurrentThreadId(null)}
          onCreateFolder={createFolder}
          onDeleteFolder={deleteFolder}
          onRenameFolder={renameFolder}
          onMoveThread={moveThreadToFolder}
        />

        <main className="flex-1 flex flex-col min-h-screen">
          <header className="h-14 border-b border-border flex items-center justify-between px-4 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="flex items-center gap-2">
              <SidebarTrigger />
              <span className="text-sm text-muted-foreground">
                {currentThreadId
                  ? threads.find((t) => t.id === currentThreadId)?.title || 'Chat'
                  : 'New Chat'}
              </span>
            </div>
            {currentThreadId && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => setDeleteDialogOpen(true)}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete Chat
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </header>

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

          <div className="p-4 bg-gradient-to-t from-background via-background to-transparent">
            <ChatInput onSend={handleSendMessage} isLoading={sendingMessage} />
          </div>
        </main>
      </div>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete chat?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this chat and all its messages. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteChat} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SidebarProvider>
  );
}
