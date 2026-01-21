import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { toast } from 'sonner';

interface ChatThread {
  id: string;
  title: string;
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
      setThreads(data || []);
    }
    setLoading(false);
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
  }, [fetchThreads]);

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
      .insert({
        user_id: user.id,
        title: initialTitle,
      })
      .select()
      .single();

    if (error) {
      toast.error('Failed to create chat thread');
      console.error(error);
      return null;
    }

    setThreads((prev) => [data, ...prev]);
    setCurrentThreadId(data.id);
    setMessages([]);
    return data;
  };

  const deleteThread = async (threadId: string) => {
    const { error } = await supabase
      .from('chat_threads')
      .delete()
      .eq('id', threadId);

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

  const sendMessage = async (content: string, webhookUrl?: string) => {
    if (!user) return;
    
    let threadId = currentThreadId;
    
    // Create a new thread if none exists
    if (!threadId) {
      const newThread = await createThread(content.slice(0, 50));
      if (!newThread) return;
      threadId = newThread.id;
    }

    // Add user message to database
    const { data: userMessage, error: userError } = await supabase
      .from('messages')
      .insert({
        thread_id: threadId,
        user_id: user.id,
        role: 'user',
        content,
      })
      .select()
      .single();

    if (userError) {
      toast.error('Failed to send message');
      console.error(userError);
      return;
    }

    setMessages((prev) => [...prev, userMessage as Message]);
    setSendingMessage(true);

    // Update thread title if it's the first message
    if (messages.length === 0) {
      await supabase
        .from('chat_threads')
        .update({ title: content.slice(0, 50) })
        .eq('id', threadId);
      
      setThreads((prev) =>
        prev.map((t) =>
          t.id === threadId ? { ...t, title: content.slice(0, 50) } : t
        )
      );
    }

    // If webhook URL is provided, call it
    if (webhookUrl) {
      try {
        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            threadId,
            userId: user.id,
            message: content,
            messages: [...messages, userMessage],
          }),
        });

        if (response.ok) {
          const data = await response.json();
          
          // Add assistant response if provided
          if (data.response) {
            const { data: assistantMessage, error: assistantError } = await supabase
              .from('messages')
              .insert({
                thread_id: threadId,
                user_id: user.id,
                role: 'assistant',
                content: data.response,
              })
              .select()
              .single();

            if (!assistantError && assistantMessage) {
              setMessages((prev) => [...prev, assistantMessage as Message]);
            }
          }
        } else {
          // Fallback response
          const { data: assistantMessage } = await supabase
            .from('messages')
            .insert({
              thread_id: threadId,
              user_id: user.id,
              role: 'assistant',
              content: 'I apologize, but I encountered an issue processing your request. Please try again.',
            })
            .select()
            .single();

          if (assistantMessage) {
            setMessages((prev) => [...prev, assistantMessage as Message]);
          }
        }
      } catch (error) {
        console.error('Webhook error:', error);
        // Add fallback response
        const { data: assistantMessage } = await supabase
          .from('messages')
          .insert({
            thread_id: threadId,
            user_id: user.id,
            role: 'assistant',
            content: 'I apologize, but I was unable to connect to the processing service. Please check your webhook configuration and try again.',
          })
          .select()
          .single();

        if (assistantMessage) {
          setMessages((prev) => [...prev, assistantMessage as Message]);
        }
      }
    } else {
      // Demo response if no webhook configured
      const { data: assistantMessage } = await supabase
        .from('messages')
        .insert({
          thread_id: threadId,
          user_id: user.id,
          role: 'assistant',
          content: 'I received your message. The chat webhook is not configured yet. Please ensure the VITE_N8N_CHAT_WEBHOOK_URL environment variable is set.',
        })
        .select()
        .single();

      if (assistantMessage) {
        setMessages((prev) => [...prev, assistantMessage as Message]);
      }
    }

    setSendingMessage(false);

    // Update thread's updated_at
    await supabase
      .from('chat_threads')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', threadId);

    fetchThreads();
  };

  return {
    threads,
    currentThreadId,
    messages,
    loading,
    sendingMessage,
    setCurrentThreadId,
    createThread,
    deleteThread,
    sendMessage,
  };
}
