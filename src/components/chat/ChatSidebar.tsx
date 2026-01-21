import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, MessageSquare, Trash2, LogOut, FolderSync, Settings, Mountain } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAuth } from '@/hooks/useAuth';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar';
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
import { toast } from 'sonner';

interface ChatThread {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

interface ChatSidebarProps {
  threads: ChatThread[];
  currentThreadId: string | null;
  onSelectThread: (id: string) => void;
  onNewThread: () => void;
  onDeleteThread: (id: string) => void;
  onIndexFiles: () => void;
  isIndexing: boolean;
}

export function ChatSidebar({
  threads,
  currentThreadId,
  onSelectThread,
  onNewThread,
  onDeleteThread,
  onIndexFiles,
  isIndexing,
}: ChatSidebarProps) {
  const { signOut, user } = useAuth();
  const navigate = useNavigate();
  const { state } = useSidebar();
  const isCollapsed = state === 'collapsed';
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [threadToDelete, setThreadToDelete] = useState<string | null>(null);

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth');
    toast.success('Signed out successfully');
  };

  const handleDeleteClick = (threadId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setThreadToDelete(threadId);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (threadToDelete) {
      onDeleteThread(threadToDelete);
      setDeleteDialogOpen(false);
      setThreadToDelete(null);
    }
  };

  return (
    <>
      <Sidebar className="border-r border-sidebar-border">
        <SidebarHeader className="p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-sidebar-primary/20 flex items-center justify-center">
              <Mountain className="h-5 w-5 text-sidebar-primary" />
            </div>
            {!isCollapsed && (
              <div className="flex-1 min-w-0">
                <h1 className="font-display text-lg font-semibold text-sidebar-foreground truncate">
                  Terra Chat
                </h1>
                <p className="text-xs text-sidebar-foreground/60 truncate">
                  Land Development AI
                </p>
              </div>
            )}
          </div>
        </SidebarHeader>

        <div className="px-3 py-2 space-y-2">
          <Button
            onClick={onNewThread}
            variant="outline"
            className="w-full justify-start gap-2 bg-sidebar-accent border-sidebar-border text-sidebar-foreground hover:bg-sidebar-primary hover:text-sidebar-primary-foreground"
          >
            <Plus className="h-4 w-4" />
            {!isCollapsed && 'New Chat'}
          </Button>
          <Button
            onClick={onIndexFiles}
            variant="outline"
            disabled={isIndexing}
            className="w-full justify-start gap-2 bg-sidebar-accent border-sidebar-border text-sidebar-foreground hover:bg-sidebar-accent/80"
          >
            <FolderSync className={`h-4 w-4 ${isIndexing ? 'animate-spin' : ''}`} />
            {!isCollapsed && (isIndexing ? 'Indexing...' : 'Index Files')}
          </Button>
        </div>

        <SidebarContent className="px-2">
          <ScrollArea className="h-full">
            <SidebarMenu>
              {threads.map((thread) => (
                <SidebarMenuItem key={thread.id}>
                  <SidebarMenuButton
                    onClick={() => onSelectThread(thread.id)}
                    isActive={currentThreadId === thread.id}
                    className="group w-full justify-between"
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <MessageSquare className="h-4 w-4 shrink-0" />
                      {!isCollapsed && (
                        <span className="truncate text-sm">{thread.title}</span>
                      )}
                    </div>
                    {!isCollapsed && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                        onClick={(e) => handleDeleteClick(thread.id, e)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </ScrollArea>
        </SidebarContent>

        <SidebarFooter className="p-3 border-t border-sidebar-border">
          <div className="flex items-center gap-2">
            {!isCollapsed && user && (
              <div className="flex-1 min-w-0">
                <p className="text-xs text-sidebar-foreground/70 truncate">
                  {user.email}
                </p>
              </div>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={handleSignOut}
              className="shrink-0 text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </SidebarFooter>
      </Sidebar>

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
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
