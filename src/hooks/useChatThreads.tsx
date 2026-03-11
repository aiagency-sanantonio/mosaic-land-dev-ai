import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
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

interface Message {
  id: string;
  thread_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

export function useChatThreads() {
  const { user } = useAuth();
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [folders, setFolders] = useState<ChatFolder[]>([]);
  const [currentThreadId, setCurrentThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [sendingMessage, setSendingMessage] = useState(false);
  const activeSubscription = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchThreads = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from('chat_threads')
      .select('*')
      .order('updated_at', { ascending: false });
    if (error) {
      toast.error('Failed to load chat threads');
      console.error(error);
    } else {
      setThreads((data as ChatThread[]) || []);
    }
    setLoading(false);
  }, [user]);

  const fetchFolders = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from('chat_folders')
      .select('*')
      .order('name', { ascending: true });
    if (error) {
      console.error(error);
    } else {
      setFolders((data as ChatFolder[]) || []);
    }
  }, [user]);

  const fetchMessages = useCallback(async (threadId: string) => {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true });
    if (error) {
      toast.error('Failed to load messages');
      console.error(error);
    } else {
      setMessages(data as Message[] || []);
    }
  }, []);

  useEffect(() => {
    fetchThreads();
    fetchFolders();
  }, [fetchThreads, fetchFolders]);

  useEffect(() => {
    if (currentThreadId) {
      fetchMessages(currentThreadId);
    } else {
      setMessages([]);
    }
  }, [currentThreadId, fetchMessages]);

  // Cleanup subscriptions on unmount
  useEffect(() => {
    return () => {
      if (activeSubscription.current) {
        supabase.removeChannel(activeSubscription.current);
      }
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const createThread = async (initialTitle: string = 'New Chat') => {
    if (!user) return null;
    const { data, error } = await supabase
      .from('chat_threads')
      .insert({ user_id: user.id, title: initialTitle })
      .select()
      .single();
    if (error) {
      toast.error('Failed to create chat thread');
      console.error(error);
      return null;
    }
    setThreads((prev) => [data as ChatThread, ...prev]);
    setCurrentThreadId(data.id);
    setMessages([]);
    return data;
  };

  const deleteThread = async (threadId: string) => {
    const { error } = await supabase.from('chat_threads').delete().eq('id', threadId);
    if (error) {
      toast.error('Failed to delete chat thread');
      console.error(error);
    } else {
      setThreads((prev) => prev.filter((t) => t.id !== threadId));
      if (currentThreadId === threadId) {
        setCurrentThreadId(null);
        setMessages([]);
      }
      toast.success('Chat deleted');
    }
  };

  const createFolder = async (name: string) => {
    if (!user) return null;
    const { data, error } = await supabase
      .from('chat_folders')
      .insert({ user_id: user.id, name })
      .select()
      .single();
    if (error) {
      toast.error('Failed to create folder');
      console.error(error);
      return null;
    }
    setFolders((prev) => [...prev, data as ChatFolder].sort((a, b) => a.name.localeCompare(b.name)));
    toast.success('Folder created');
    return data;
  };

  const deleteFolder = async (folderId: string) => {
    const { error } = await supabase.from('chat_folders').delete().eq('id', folderId);
    if (error) {
      toast.error('Failed to delete folder');
      console.error(error);
    } else {
      setFolders((prev) => prev.filter((f) => f.id !== folderId));
      setThreads((prev) => prev.map((t) => t.folder_id === folderId ? { ...t, folder_id: null } : t));
      toast.success('Folder deleted');
    }
  };

  const renameFolder = async (folderId: string, newName: string) => {
    const { error } = await supabase.from('chat_folders').update({ name: newName }).eq('id', folderId);
    if (error) {
      toast.error('Failed to rename folder');
      console.error(error);
    } else {
      setFolders((prev) => prev.map((f) => f.id === folderId ? { ...f, name: newName } : f).sort((a, b) => a.name.localeCompare(b.name)));
    }
  };

  const moveThreadToFolder = async (threadId: string, folderId: string | null) => {
    const { error } = await supabase.from('chat_threads').update({ folder_id: folderId }).eq('id', threadId);
    if (error) {
      toast.error('Failed to move chat');
      console.error(error);
    } else {
      setThreads((prev) => prev.map((t) => t.id === threadId ? { ...t, folder_id: folderId } : t));
    }
  };

  const cleanupJobSubscription = useCallback(() => {
    if (activeSubscription.current) {
      supabase.removeChannel(activeSubscription.current);
      activeSubscription.current = null;
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const sendMessage = async (content: string, webhookMode?: string) => {
    if (!user) return;
    let threadId = currentThreadId;
    if (!threadId) {
      const newThread = await createThread(content.slice(0, 50));
      if (!newThread) return;
      threadId = newThread.id;
    }

    const { data: userMessage, error: userError } = await supabase
      .from('messages')
      .insert({ thread_id: threadId, user_id: user.id, role: 'user', content })
      .select()
      .single();

    if (userError) {
      toast.error('Failed to send message');
      console.error(userError);
      return;
    }

    setMessages((prev) => [...prev, userMessage as Message]);
    setSendingMessage(true);

    if (messages.length === 0) {
      await supabase.from('chat_threads').update({ title: content.slice(0, 50) }).eq('id', threadId);
      setThreads((prev) => prev.map((t) => t.id === threadId ? { ...t, title: content.slice(0, 50) } : t));
    }

    if (webhookMode === 'edge-function') {
      try {
        const { data, error } = await supabase.functions.invoke('chat-webhook', {
          body: {
            threadId, userId: user.id, message: content,
            messages: [...messages, userMessage].map(m => ({ role: m.role, content: m.content })),
            chatHistory: [...messages, userMessage].map(m => `${m.role}: ${m.content}`).join('\n'),
          },
        });

        console.log('Edge function response:', { data, error });

        if (error || !data?.job_id) {
          const errorMsg = 'I apologize, but I encountered an issue processing your request. Please try again.';
          const { data: assistantMessage } = await supabase
            .from('messages')
            .insert({ thread_id: threadId, user_id: user.id, role: 'assistant', content: errorMsg })
            .select()
            .single();
          if (assistantMessage) setMessages((prev) => [...prev, assistantMessage as Message]);
          setSendingMessage(false);
          return;
        }

        const jobId = data.job_id;
        const capturedThreadId = threadId;

        // Clean up any previous subscription
        cleanupJobSubscription();

        // Set 10 minute timeout
        timeoutRef.current = setTimeout(async () => {
          cleanupJobSubscription();
          setSendingMessage(false);
          const timeoutMsg = 'The request timed out after 10 minutes. Please try again.';
          const { data: assistantMessage } = await supabase
            .from('messages')
            .insert({ thread_id: capturedThreadId, user_id: user!.id, role: 'assistant', content: timeoutMsg })
            .select()
            .single();
          if (assistantMessage) setMessages((prev) => [...prev, assistantMessage as Message]);
        }, 600000);

        // Subscribe to realtime updates on this job
        const channel = supabase
          .channel(`chat-job-${jobId}`)
          .on(
            'postgres_changes',
            {
              event: 'UPDATE',
              schema: 'public',
              table: 'chat_jobs',
              filter: `id=eq.${jobId}`,
            },
            async (payload) => {
              const newStatus = payload.new?.status;
              const responseContent = payload.new?.response_content;

              console.log('Job update received:', { newStatus, responseContent });

              if (newStatus === 'completed' || newStatus === 'failed') {
                cleanupJobSubscription();
                setSendingMessage(false);

                const finalContent = responseContent || 'I received your message but could not generate a response.';
                const { data: assistantMessage } = await supabase
                  .from('messages')
                  .insert({ thread_id: capturedThreadId, user_id: user!.id, role: 'assistant', content: finalContent })
                  .select()
                  .single();
                if (assistantMessage) setMessages((prev) => [...prev, assistantMessage as Message]);

                await supabase.from('chat_threads').update({ updated_at: new Date().toISOString() }).eq('id', capturedThreadId);
                fetchThreads();
              }
            }
          )
          .subscribe();

        activeSubscription.current = channel;

        // Also poll once after 5 seconds as a fallback in case realtime missed the update
        setTimeout(async () => {
          const { data: jobData } = await supabase
            .from('chat_jobs')
            .select('status, response_content')
            .eq('id', jobId)
            .single();
          
          if (jobData && (jobData.status === 'completed' || jobData.status === 'failed') && activeSubscription.current) {
            console.log('Fallback poll caught completed job');
            cleanupJobSubscription();
            setSendingMessage(false);

            const finalContent = jobData.response_content || 'I received your message but could not generate a response.';
            const { data: assistantMessage } = await supabase
              .from('messages')
              .insert({ thread_id: capturedThreadId, user_id: user!.id, role: 'assistant', content: finalContent })
              .select()
              .single();
            if (assistantMessage) setMessages((prev) => [...prev, assistantMessage as Message]);

            await supabase.from('chat_threads').update({ updated_at: new Date().toISOString() }).eq('id', capturedThreadId);
            fetchThreads();
          }
        }, 5000);

      } catch (error) {
        console.error('Webhook error:', error);
        const { data: assistantMessage } = await supabase
          .from('messages')
          .insert({ thread_id: threadId, user_id: user.id, role: 'assistant', content: 'I apologize, but I was unable to connect to the processing service. Please try again later.' })
          .select()
          .single();
        if (assistantMessage) setMessages((prev) => [...prev, assistantMessage as Message]);
        setSendingMessage(false);
      }
    } else {
      const { data: assistantMessage } = await supabase
        .from('messages')
        .insert({ thread_id: threadId, user_id: user.id, role: 'assistant', content: 'Chat service is initializing. Please try again in a moment.' })
        .select()
        .single();
      if (assistantMessage) setMessages((prev) => [...prev, assistantMessage as Message]);
      setSendingMessage(false);
    }

    // Note: updated_at and fetchThreads are now handled inside the realtime callback
    // for the async path, but still needed for the non-edge-function path
    if (webhookMode !== 'edge-function') {
      await supabase.from('chat_threads').update({ updated_at: new Date().toISOString() }).eq('id', threadId);
      fetchThreads();
    }
  };

  return {
    threads, folders, currentThreadId, messages, loading, sendingMessage,
    setCurrentThreadId, createThread, deleteThread, sendMessage,
    createFolder, deleteFolder, renameFolder, moveThreadToFolder,
  };
}
