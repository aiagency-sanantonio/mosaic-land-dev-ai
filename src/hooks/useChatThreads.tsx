import { useState, useEffect, useCallback } from 'react';
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

  // Folder CRUD
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
      // Threads with this folder_id will be set to null by DB cascade
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

  const sendMessage = async (content: string, webhookMode?: string, file?: File, uploadId?: string) => {
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

    // Upload file if provided
    let uploadedFilePath: string | undefined;
    if (file) {
      const fileExt = file.name.split('.').pop();
      const filePath = `${user.id}/${threadId}/${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from('user-uploads')
        .upload(filePath, file);

      if (uploadError) {
        console.error('File upload error:', uploadError);
        toast.error('Failed to upload file');
      } else {
        uploadedFilePath = filePath;
        await supabase.from('user_uploads').insert({
          user_id: user.id,
          thread_id: threadId,
          file_name: file.name,
          file_path: filePath,
          file_size_bytes: file.size,
          status: 'uploaded',
        });
      }
    }

    setSendingMessage(true);

    if (messages.length === 0) {
      await supabase.from('chat_threads').update({ title: content.slice(0, 50) }).eq('id', threadId);
      setThreads((prev) => prev.map((t) => t.id === threadId ? { ...t, title: content.slice(0, 50) } : t));
    }

    if (webhookMode === 'edge-function') {
      try {
        // Fetch extracted text if an upload is attached
        let uploadedDocument: string | undefined;
        if (uploadId) {
          const { data: uploadData } = await supabase
            .from('user_uploads')
            .select('extracted_text')
            .eq('id', uploadId)
            .single();
          if (uploadData?.extracted_text) {
            uploadedDocument = uploadData.extracted_text;
          }
        }

        const { data, error } = await supabase.functions.invoke('chat-webhook', {
          body: {
            threadId, userId: user.id, message: content,
            messages: [...messages, userMessage].map(m => ({ role: m.role, content: m.content })),
            chatHistory: [...messages, userMessage].map(m => `${m.role}: ${m.content}`).join('\n'),
            ...(uploadedFilePath ? { uploadedFilePath } : {}),
            ...(uploadedDocument ? { uploaded_document: uploadedDocument } : {}),
          },
        });

        console.log('chat-webhook response:', { data, error });

        if (error || !data?.job_id) {
          // Fallback: no async job created, show error
          const fallbackContent = 'I apologize, but I encountered an issue processing your request. Please try again.';
          const { data: assistantMessage } = await supabase
            .from('messages')
            .insert({ thread_id: threadId, user_id: user.id, role: 'assistant', content: fallbackContent })
            .select()
            .single();
          if (assistantMessage) setMessages((prev) => [...prev, assistantMessage as Message]);
          setSendingMessage(false);
        } else {
          // Subscribe to Realtime updates for this job
          const jobId = data.job_id;
          const timeoutMs = 10 * 60 * 1000; // 10 minutes
          let resolved = false;

          const handleJobDone = async () => {
            if (resolved) return;
            resolved = true;
            if (threadId) {
              await fetchMessages(threadId);
            }
            setSendingMessage(false);
            supabase.removeChannel(channel);
            clearTimeout(timeout);
            clearInterval(pollInterval);
            await supabase.from('chat_threads').update({ updated_at: new Date().toISOString() }).eq('id', threadId);
            fetchThreads();
          };

          const channel = supabase
            .channel(`job-${jobId}`)
            .on(
              'postgres_changes',
              {
                event: 'UPDATE',
                schema: 'public',
                table: 'chat_jobs',
                filter: `id=eq.${jobId}`,
              },
              async (payload) => {
                const job = payload.new as { status: string; response_content: string | null };
                console.log('Job update received:', job.status);
                if (job.status === 'completed' || job.status === 'failed') {
                  await handleJobDone();
                }
              }
            )
            .subscribe(async (status) => {
              if (status === 'SUBSCRIBED') {
                const { data: existingJob } = await supabase
                  .from('chat_jobs')
                  .select('status, response_content')
                  .eq('id', jobId)
                  .single();
                if (existingJob && (existingJob.status === 'completed' || existingJob.status === 'failed')) {
                  await handleJobDone();
                }
              }
            });

          // Polling fallback every 3s in case Realtime doesn't fire
          const pollInterval = setInterval(async () => {
            const { data: polledJob } = await supabase
              .from('chat_jobs')
              .select('status, response_content')
              .eq('id', jobId)
              .single();

            if (polledJob && (polledJob.status === 'completed' || polledJob.status === 'failed')) {
              console.log('Poll detected job completion:', polledJob.status);
              clearInterval(pollInterval);
              clearTimeout(timeout);
              supabase.removeChannel(channel);
              if (threadId) {
                await fetchMessages(threadId);
              }
              setSendingMessage(false);
              await supabase.from('chat_threads').update({ updated_at: new Date().toISOString() }).eq('id', threadId);
              fetchThreads();
            }
          }, 3000);

          // Timeout fallback
          const timeout = setTimeout(async () => {
            console.warn('Job timed out:', jobId);
            clearInterval(pollInterval);
            supabase.removeChannel(channel);
            const { data: assistantMessage } = await supabase
              .from('messages')
              .insert({ thread_id: threadId!, user_id: user!.id, role: 'assistant', content: 'The request timed out. The AI agent may still be processing — please check back shortly.' })
              .select()
              .single();
            if (assistantMessage) setMessages((prev) => [...prev, assistantMessage as Message]);
            setSendingMessage(false);
          }, timeoutMs);
        }
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

    // Don't update thread timestamp here for async mode — it's done when the job completes
  };

  return {
    threads, folders, currentThreadId, messages, loading, sendingMessage,
    setCurrentThreadId, createThread, deleteThread, sendMessage,
    createFolder, deleteFolder, renameFolder, moveThreadToFolder,
  };
}
