import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, MessageSquare, Trash2, LogOut, Mountain, FolderPlus, ChevronRight, FolderOpen, Pencil, Settings, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/useAuth';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
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
  folder_id: string | null;
}

interface ChatFolder {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

interface ChatSidebarProps {
  threads: ChatThread[];
  folders: ChatFolder[];
  currentThreadId: string | null;
  onSelectThread: (id: string) => void;
  onNewThread: () => void;
  onCreateFolder: (name: string) => void;
  onDeleteFolder: (id: string) => void;
  onRenameFolder: (id: string, name: string) => void;
  onMoveThread: (threadId: string, folderId: string | null) => void;
}

export function ChatSidebar({
  threads, folders, currentThreadId,
  onSelectThread, onNewThread,
  onCreateFolder, onDeleteFolder, onRenameFolder, onMoveThread,
}: ChatSidebarProps) {
  const { signOut, user } = useAuth();
  const navigate = useNavigate();
  const { state } = useSidebar();
  const isCollapsed = state === 'collapsed';

  const [folderToDelete, setFolderToDelete] = useState<string | null>(null);
  const [deleteFolderDialogOpen, setDeleteFolderDialogOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth');
    toast.success('Signed out successfully');
  };

  const handleDeleteFolder = (folderId: string) => {
    setFolderToDelete(folderId);
    setDeleteFolderDialogOpen(true);
  };

  const confirmDeleteFolder = () => {
    if (folderToDelete) onDeleteFolder(folderToDelete);
    setDeleteFolderDialogOpen(false);
    setFolderToDelete(null);
  };

  const handleCreateFolder = () => {
    if (newFolderName.trim()) {
      onCreateFolder(newFolderName.trim());
      setNewFolderName('');
      setShowNewFolder(false);
    }
  };

  const handleRenameFolder = (folderId: string) => {
    if (renameValue.trim()) {
      onRenameFolder(folderId, renameValue.trim());
      setRenamingFolder(null);
      setRenameValue('');
    }
  };

  const ungroupedThreads = threads.filter((t) => !t.folder_id);
  const threadsByFolder = (folderId: string) => threads.filter((t) => t.folder_id === folderId);

  const handleDragStart = (e: React.DragEvent, threadId: string) => {
    e.dataTransfer.setData('text/plain', threadId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDrop = (e: React.DragEvent, folderId: string | null) => {
    e.preventDefault();
    setDragOverTarget(null);
    const threadId = e.dataTransfer.getData('text/plain');
    if (threadId) onMoveThread(threadId, folderId);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const renderThread = (thread: ChatThread) => (
    <SidebarMenuItem key={thread.id} draggable onDragStart={(e) => handleDragStart(e, thread.id)}>
      <SidebarMenuButton
        onClick={() => onSelectThread(thread.id)}
        isActive={currentThreadId === thread.id}
        className="min-w-0 flex-1"
      >
        <MessageSquare className="h-4 w-4 shrink-0" />
        {!isCollapsed && <span className="truncate min-w-0">{thread.title}</span>}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );

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
                <h1 className="font-display text-lg font-semibold text-sidebar-foreground truncate">Terra Chat</h1>
                <p className="text-xs text-sidebar-foreground/60 truncate">Land Development AI</p>
              </div>
            )}
          </div>
        </SidebarHeader>

        <div className="px-3 py-2 space-y-2">
          <Button onClick={onNewThread} variant="outline" className="w-full justify-start gap-2 bg-sidebar-accent border-sidebar-border text-sidebar-foreground hover:bg-sidebar-primary hover:text-sidebar-primary-foreground">
            <Plus className="h-4 w-4" />
            {!isCollapsed && 'New Chat'}
          </Button>
          <Button onClick={() => navigate('/web-links')} variant="ghost" size="sm" className="w-full justify-start gap-2 text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent">
            <Link2 className="h-4 w-4" />
            {!isCollapsed && 'Web Links'}
          </Button>
          {!isCollapsed && (
            showNewFolder ? (
              <div className="flex gap-1">
                <Input
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="Folder name"
                  className="h-8 text-sm text-foreground bg-background"
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
                  autoFocus
                />
                <Button size="sm" variant="ghost" className="h-8 px-2" onClick={handleCreateFolder}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <Button onClick={() => setShowNewFolder(true)} variant="ghost" size="sm" className="w-full justify-start gap-2 text-sidebar-foreground/70 hover:text-sidebar-foreground">
                <FolderPlus className="h-4 w-4" />
                New Folder
              </Button>
            )
          )}
        </div>

        <SidebarContent className="px-2">
          <ScrollArea className="h-full">
            {/* Folders */}
            {folders.map((folder) => (
              <Collapsible key={folder.id} defaultOpen className="mb-1">
                <div
                  className={`flex items-center rounded transition-colors ${dragOverTarget === folder.id ? 'bg-sidebar-accent ring-1 ring-sidebar-primary' : ''}`}
                  onDragOver={handleDragOver}
                  onDragEnter={() => setDragOverTarget(folder.id)}
                  onDragLeave={() => setDragOverTarget(null)}
                  onDrop={(e) => handleDrop(e, folder.id)}
                >
                  <CollapsibleTrigger className="flex items-center gap-1 flex-1 px-2 py-1.5 text-xs font-medium text-sidebar-foreground/70 hover:text-sidebar-foreground rounded min-w-0">
                    <ChevronRight className="h-3 w-3 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-90" />
                    <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                    {renamingFolder === folder.id ? (
                      <Input
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        className="h-5 text-xs w-24 text-foreground bg-background"
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleRenameFolder(folder.id); }}
                        autoFocus
                      />
                    ) : (
                      <span className="truncate">{folder.name}</span>
                    )}
                  </CollapsibleTrigger>
                </div>
                <CollapsibleContent>
                  <div className="flex items-center gap-1 pl-9 py-1 mb-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs text-sidebar-foreground/60 hover:text-sidebar-foreground"
                      onClick={() => { setRenamingFolder(folder.id); setRenameValue(folder.name); }}
                    >
                      <Pencil className="h-3 w-3 mr-1" />
                      Rename
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs text-destructive/70 hover:text-destructive"
                      onClick={() => handleDeleteFolder(folder.id)}
                    >
                      <Trash2 className="h-3 w-3 mr-1" />
                      Delete
                    </Button>
                  </div>
                  <SidebarMenu className="pl-4">
                    {threadsByFolder(folder.id).length === 0 ? (
                      <p className="text-xs text-sidebar-foreground/40 px-2 py-1">No chats</p>
                    ) : (
                      threadsByFolder(folder.id).map(renderThread)
                    )}
                  </SidebarMenu>
                </CollapsibleContent>
              </Collapsible>
            ))}

            {/* Ungrouped */}
            {ungroupedThreads.length > 0 && (
              <div
                className={`mt-1 rounded transition-colors ${dragOverTarget === 'ungrouped' ? 'bg-sidebar-accent ring-1 ring-sidebar-primary' : ''}`}
                onDragOver={handleDragOver}
                onDragEnter={() => setDragOverTarget('ungrouped')}
                onDragLeave={() => setDragOverTarget(null)}
                onDrop={(e) => handleDrop(e, null)}
              >
                {folders.length > 0 && (
                  <p className="px-2 py-1.5 text-xs font-medium text-sidebar-foreground/70">Chats</p>
                )}
                <SidebarMenu>
                  {ungroupedThreads.map(renderThread)}
                </SidebarMenu>
              </div>
            )}
          </ScrollArea>
        </SidebarContent>

        <SidebarFooter className="p-3 border-t border-sidebar-border">
          <div className="flex items-center gap-2">
            {!isCollapsed && user && (
              <div className="flex-1 min-w-0">
                <p className="text-xs text-sidebar-foreground/70 truncate">{user.email}</p>
              </div>
            )}
            <Button variant="ghost" size="icon" onClick={() => navigate('/settings')} className="shrink-0 text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent" title="Settings">
              <Settings className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={handleSignOut} className="shrink-0 text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent" title="Sign out">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </SidebarFooter>
      </Sidebar>

      <AlertDialog open={deleteFolderDialogOpen} onOpenChange={setDeleteFolderDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete folder?</AlertDialogTitle>
            <AlertDialogDescription>
              This will delete the folder. Chats inside will be moved to the ungrouped section.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteFolder} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
