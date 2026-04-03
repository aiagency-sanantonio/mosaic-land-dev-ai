import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { ChatMessage } from '@/components/chat/ChatMessage';
import { Loader2 } from 'lucide-react';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  file_name: string | null;
}

export default function SharedThread() {
  const { token } = useParams<{ token: string }>();
  const [title, setTitle] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!token) { setError(true); setLoading(false); return; }

    (async () => {
      // Fetch the shared_threads row
      const { data: share, error: shareErr } = await supabase
        .from('shared_threads')
        .select('thread_id, is_active, expires_at')
        .eq('share_token', token)
        .maybeSingle();

      if (shareErr || !share || !share.is_active || new Date(share.expires_at) <= new Date()) {
        setError(true); setLoading(false); return;
      }

      // Fetch thread title
      const { data: thread } = await supabase
        .from('chat_threads')
        .select('title')
        .eq('id', share.thread_id)
        .maybeSingle();

      setTitle(thread?.title || 'Shared Chat');

      // Fetch messages
      const { data: msgs } = await supabase
        .from('messages')
        .select('id, role, content, file_name')
        .eq('thread_id', share.thread_id)
        .order('created_at', { ascending: true });

      setMessages((msgs as Message[]) || []);
      setLoading(false);
    })();
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground text-sm">This link has expired or is no longer active.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="h-14 border-b border-border flex items-center px-4 bg-background/95 backdrop-blur">
        <span className="text-sm text-muted-foreground">{title}</span>
      </header>
      <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-8">
        {messages.map((msg) => (
          <ChatMessage key={msg.id} role={msg.role} content={msg.content} fileName={msg.file_name} />
        ))}
      </div>
    </div>
  );
}
