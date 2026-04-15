import { useState, useRef, useEffect } from 'react';
import { Send, Loader2, Paperclip, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

const ACCEPTED_TYPES = '.pdf,.docx,.xlsx,.txt';
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

interface ChatInputProps {
  onSend: (message: string, file?: File) => void;
  isLoading?: boolean;
  disabled?: boolean;
}

export function ChatInput({ onSend, isLoading = false, disabled = false }: ChatInputProps) {
  const [message, setMessage] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [message]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_FILE_SIZE) {
      alert('File size must be under 10MB.');
      return;
    }

    setSelectedFile(file);
    // Reset input so re-selecting the same file triggers onChange
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if ((message.trim() || selectedFile) && !isLoading && !disabled) {
      onSend(message.trim(), selectedFile || undefined);
      setMessage('');
      setSelectedFile(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-4xl mx-auto">
      <div className="relative flex flex-col gap-2 p-4 bg-card rounded-2xl border border-border shadow-soft">
        {selectedFile && (
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-muted text-sm text-foreground max-w-[280px]">
              <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{selectedFile.name}</span>
              <button
                type="button"
                onClick={() => setSelectedFile(null)}
                className="ml-1 rounded-full p-0.5 hover:bg-background transition-colors"
                aria-label="Remove file"
              >
                <X className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </span>
          </div>
        )}

        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_TYPES}
            onChange={handleFileSelect}
            className="hidden"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-10 w-10 shrink-0 rounded-xl text-muted-foreground hover:text-foreground"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled || isLoading}
          >
            <Paperclip className="h-4 w-4" />
          </Button>

          <Textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about parcels, zoning, paste a URL, or a YouTube link to summarize..."
            className="min-h-[44px] max-h-[200px] resize-none border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-muted-foreground/60"
            rows={1}
            disabled={disabled || isLoading}
          />
          <Button
            type="submit"
            size="icon"
            disabled={(!message.trim() && !selectedFile) || isLoading || disabled}
            className="h-10 w-10 shrink-0 rounded-xl"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground text-center mt-2">
        Press Enter to send, Shift + Enter for new line
      </p>
    </form>
  );
}
