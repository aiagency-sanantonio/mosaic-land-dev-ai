import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useWebLinks, useDeleteWebLink, LINK_CATEGORIES } from '@/hooks/useWebLinks';
import { LinkCard } from '@/components/weblinks/LinkCard';
import { AddLinkDialog } from '@/components/weblinks/AddLinkDialog';
import { cn } from '@/lib/utils';

export default function WebLinks() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [addOpen, setAddOpen] = useState(false);

  const { data: links = [], isLoading } = useWebLinks(search, categoryFilter);
  const deleteLink = useDeleteWebLink();

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border px-4 py-3">
        <div className="max-w-5xl mx-auto flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/')} className="shrink-0">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="font-display text-lg font-semibold flex-1">Web Links</h1>
          <Button onClick={() => setAddOpen(true)} size="sm" className="gap-1.5">
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Add Link</span>
          </Button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-4">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search links by name, project, or URL..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Category filters */}
        <div className="flex flex-wrap gap-1.5">
          <Badge
            variant={!categoryFilter ? 'default' : 'outline'}
            className="cursor-pointer"
            onClick={() => setCategoryFilter('')}
          >
            All
          </Badge>
          {LINK_CATEGORIES.map((cat) => (
            <Badge
              key={cat}
              variant={categoryFilter === cat ? 'default' : 'outline'}
              className={cn(
                'cursor-pointer transition-colors',
                categoryFilter === cat && 'bg-primary text-primary-foreground'
              )}
              onClick={() => setCategoryFilter(categoryFilter === cat ? '' : cat)}
            >
              {cat}
            </Badge>
          ))}
        </div>

        {/* Links grid */}
        {isLoading ? (
          <div className="text-center text-muted-foreground py-12">Loading...</div>
        ) : links.length === 0 ? (
          <div className="text-center text-muted-foreground py-12">
            <p className="text-sm">No links found</p>
            <Button variant="link" onClick={() => setAddOpen(true)} className="mt-2">
              Add your first link
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {links.map((link) => (
              <LinkCard key={link.id} link={link} onDelete={(id) => deleteLink.mutate(id)} />
            ))}
          </div>
        )}
      </main>

      <AddLinkDialog open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}
