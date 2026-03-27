import { User, Bot, Paperclip } from 'lucide-react';
import { cn } from '@/lib/utils';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';

interface ChatMessageProps {
  role: 'user' | 'assistant';
  content: string;
  isNew?: boolean;
  fileName?: string | null;
}

const markdownComponents: Components = {
  h1: ({ children }) => (
    <h1 className="font-display text-lg font-semibold text-foreground mb-2 mt-3 first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="font-display text-base font-semibold text-foreground mb-2 mt-3 first:mt-0 pb-1 border-b border-border/50">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="font-display text-sm font-semibold text-foreground mb-1.5 mt-2.5 first:mt-0">{children}</h3>
  ),
  p: ({ children }) => (
    <p className="text-sm leading-relaxed mb-2 last:mb-0">{children}</p>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold">{children}</strong>
  ),
  ul: ({ children }) => (
    <ul className="list-disc list-outside ml-4 mb-2 space-y-1 text-sm">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal list-outside ml-4 mb-2 space-y-1 text-sm">{children}</ol>
  ),
  li: ({ children }) => (
    <li className="leading-relaxed">{children}</li>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-3 border-primary/60 bg-muted/50 pl-3 py-1.5 my-2 rounded-r-md text-sm italic">{children}</blockquote>
  ),
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-2 hover:underline font-medium">{children}</a>
  ),
  hr: () => (
    <hr className="my-3 border-border/60" />
  ),
  table: ({ children }) => (
    <div className="overflow-x-auto my-2 rounded-md border border-border/60">
      <table className="w-full text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-muted/60">{children}</thead>
  ),
  tbody: ({ children }) => (
    <tbody className="divide-y divide-border/40">{children}</tbody>
  ),
  tr: ({ children }) => (
    <tr className="even:bg-muted/30">{children}</tr>
  ),
  th: ({ children }) => (
    <th className="px-3 py-1.5 text-left font-semibold text-xs uppercase tracking-wide">{children}</th>
  ),
  td: ({ children }) => (
    <td className="px-3 py-1.5">{children}</td>
  ),
  code: ({ className, children }) => {
    const isBlock = className?.includes('language-');
    if (isBlock) {
      return (
        <pre className="bg-earth/10 rounded-md p-3 my-2 overflow-x-auto">
          <code className="text-xs font-mono">{children}</code>
        </pre>
      );
    }
    return (
      <code className="bg-muted/70 rounded px-1.5 py-0.5 text-xs font-mono">{children}</code>
    );
  },
  pre: ({ children }) => <>{children}</>,
};

export function ChatMessage({ role, content, isNew = false }: ChatMessageProps) {
  const isUser = role === 'user';

  return (
    <div
      className={cn(
        'flex gap-3 max-w-4xl mx-auto',
        isUser ? 'flex-row-reverse' : 'flex-row',
        isNew && 'animate-slide-up'
      )}
    >
      <div
        className={cn(
          'w-8 h-8 rounded-full flex items-center justify-center shrink-0',
          isUser ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'
        )}
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>
      
      <div
        className={cn(
          'max-w-[80%] md:max-w-[70%]',
          isUser ? 'chat-bubble-user' : 'chat-bubble-assistant'
        )}
      >
        {isUser ? (
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{content}</p>
        ) : (
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {content}
          </ReactMarkdown>
        )}
      </div>
    </div>
  );
}
