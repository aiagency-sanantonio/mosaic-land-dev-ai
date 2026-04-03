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
  file_name?: string | null;
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
      .insert({ thread_id: threadId, user_id: user.id, role: 'user', content, file_name: file?.name || null })
      .select()
      .single();

    if (userError) {
      toast.error('Failed to send message');
      console.error(userError);
      return;
    }

    setMessages((prev) => [...prev, userMessage as Message]);

    // Process file upload first so extracted text can be added to chat context
    let resolvedUploadId = uploadId;
    if (file && !resolvedUploadId) {
      try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('user_id', user.id);
        formData.append('thread_id', threadId);
        formData.append('file_name', file.name);

        const { data: uploadResponse, error: uploadError } = await supabase.functions.invoke('process-upload', {
          body: formData,
        });

        if (uploadError || !uploadResponse?.upload_id) {
          console.error('File processing error:', uploadError || uploadResponse);
          toast.error('Failed to process file');
        } else {
          resolvedUploadId = uploadResponse.upload_id as string;
        }
      } catch (error) {
        console.error('File processing error:', error);
        toast.error('Failed to process file');
      }
    }

    setSendingMessage(true);

    if (messages.length === 0) {
      await supabase.from('chat_threads').update({ title: content.slice(0, 50) }).eq('id', threadId);
      setThreads((prev) => prev.map((t) => t.id === threadId ? { ...t, title: content.slice(0, 50) } : t));
    }

    if (webhookMode === 'edge-function') {
      try {
        // Fetch extracted text from ALL uploads in this thread (not just the current one)
        let uploadedDocument: string | undefined;
        const { data: threadUploads } = await supabase
          .from('user_uploads')
          .select('extracted_summary, extracted_text, file_name')
          .eq('thread_id', threadId)
          .not('extracted_text', 'is', null);

        if (threadUploads?.length) {
          uploadedDocument = threadUploads
            .map((u: any) => {
              // Prefer structured summary over raw text
              const content = u.extracted_summary || (u.extracted_text?.slice(0, 5000) ?? '');
              return `[${u.file_name}]\n${content}`;
            })
            .join('\n\n---\n\n')
            .slice(0, 30000);
        }

        const { data, error } = await supabase.functions.invoke('chat-webhook', {
          body: {
            threadId, userId: user.id, message: content,
            messages: [...messages, userMessage].map(m => ({ role: m.role, content: m.content })),
            chatHistory: [...messages, userMessage].map(m => `${m.role}: ${m.content}`).join('\n'),
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
            supabase.removeChannel(channel);
            clearTimeout(timeout);
            clearInterval(pollInterval);

            if (threadId) {
              await fetchMessages(threadId);
            }

            // Check if the job failed — if so, ensure the user sees an error message
            const { data: finishedJob } = await supabase
              .from('chat_jobs')
              .select('status, response_content')
              .eq('id', jobId)
              .single();

            if (finishedJob?.status === 'failed') {
              const errorContent = finishedJob.response_content || 'I encountered an issue processing your request. Please try again.';
              // Insert error message into DB so it persists across refreshes
              const { data: errorMsg } = await supabase
                .from('messages')
                .insert({ thread_id: threadId!, user_id: user!.id, role: 'assistant', content: errorContent })
                .select()
                .single();
              if (errorMsg) {
                setMessages((prev) => {
                  // Avoid duplicates if fetchMessages already picked it up
                  if (prev.some(m => m.id === (errorMsg as Message).id)) return prev;
                  return [...prev, errorMsg as Message];
                });
              }
            }

            setSendingMessage(false);
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

          // Immediate poll to catch jobs that completed before subscription was ready
          setTimeout(async () => {
            if (resolved) return;
            const { data: earlyJob } = await supabase
              .from('chat_jobs')
              .select('status, response_content')
              .eq('id', jobId)
              .single();
            if (earlyJob && (earlyJob.status === 'completed' || earlyJob.status === 'failed')) {
              console.log('Early poll detected job completion:', earlyJob.status);
              await handleJobDone();
            }
          }, 500);

          // Polling fallback every 2s in case Realtime doesn't fire
          const pollInterval = setInterval(async () => {
            if (resolved) { clearInterval(pollInterval); return; }
            const { data: polledJob } = await supabase
              .from('chat_jobs')
              .select('status, response_content')
              .eq('id', jobId)
              .single();

            if (polledJob && (polledJob.status === 'completed' || polledJob.status === 'failed')) {
              console.log('Poll detected job completion:', polledJob.status);
              await handleJobDone();
            }
          }, 2000);

          // Timeout fallback
          const timeout = setTimeout(async () => {
            if (resolved) return;
            resolved = true;
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
