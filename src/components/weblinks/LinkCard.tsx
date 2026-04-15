import { ExternalLink, Trash2, Calendar } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import type { WebLink } from '@/hooks/useWebLinks';

interface LinkCardProps {
  link: WebLink;
  onDelete: (id: string) => void;
}

export function LinkCard({ link, onDelete }: LinkCardProps) {
  const { user } = useAuth();
  const isOwner = user?.id === link.added_by;
  const date = new Date(link.created_at).toLocaleDateString();

  return (
    <div className="p-4 rounded-xl bg-card border border-border hover:border-primary/30 hover:shadow-soft transition-all group">
      <div className="flex items-start justify-between gap-2 mb-2">
        <a
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-sm text-foreground hover:text-primary transition-colors flex items-center gap-1.5 min-w-0"
        >
          <span className="truncate">{link.name}</span>
          <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </a>
        {isOwner && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 text-muted-foreground hover:text-destructive"
            onClick={() => onDelete(link.id)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      <p className="text-xs text-muted-foreground truncate mb-2">{link.url}</p>

      {link.project_name && (
        <p className="text-xs font-medium text-foreground/80 mb-1.5">
          {link.project_name}
        </p>
      )}

      {link.categories.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {link.categories.map((cat) => (
            <Badge key={cat} variant="secondary" className="text-[10px] px-1.5 py-0">
              {cat}
            </Badge>
          ))}
        </div>
      )}

      {link.notes && (
        <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{link.notes}</p>
      )}

      <div className="flex items-center gap-1 text-[10px] text-muted-foreground/60">
        <Calendar className="h-3 w-3" />
        {date}
      </div>
    </div>
  );
}
