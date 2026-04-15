import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { LINK_CATEGORIES, useAddWebLink } from '@/hooks/useWebLinks';
import { cn } from '@/lib/utils';

interface AddLinkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefillUrl?: string;
  prefillName?: string;
}

export function AddLinkDialog({ open, onOpenChange, prefillUrl, prefillName }: AddLinkDialogProps) {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [projectName, setProjectName] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const addLink = useAddWebLink();

  useEffect(() => {
    if (open) {
      setUrl(prefillUrl || '');
      setName(prefillName || '');
      setProjectName('');
      setCategories([]);
      setNotes('');
    }
  }, [open, prefillUrl, prefillName]);

  const toggleCategory = (cat: string) => {
    setCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  };

  const handleSubmit = () => {
    if (!url.trim() || !name.trim()) return;
    addLink.mutate(
      {
        name: name.trim(),
        url: url.trim(),
        project_name: projectName.trim() || undefined,
        categories,
        notes: notes.trim() || undefined,
      },
      { onSuccess: () => onOpenChange(false) }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save Web Link</DialogTitle>
          <DialogDescription>Add a link to the shared team library.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="link-url">URL *</Label>
            <Input
              id="link-url"
              placeholder="https://..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="link-name">Name *</Label>
            <Input
              id="link-name"
              placeholder="Link name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="link-project">Project Name</Label>
            <Input
              id="link-project"
              placeholder="e.g. Fischer Ranch"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Categories</Label>
            <div className="flex flex-wrap gap-1.5">
              {LINK_CATEGORIES.map((cat) => (
                <Badge
                  key={cat}
                  variant={categories.includes(cat) ? 'default' : 'outline'}
                  className={cn(
                    'cursor-pointer transition-colors',
                    categories.includes(cat) && 'bg-primary text-primary-foreground'
                  )}
                  onClick={() => toggleCategory(cat)}
                >
                  {cat}
                </Badge>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="link-notes">Notes</Label>
            <Textarea
              id="link-notes"
              placeholder="Optional notes..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!url.trim() || !name.trim() || addLink.isPending}
          >
            {addLink.isPending ? 'Saving...' : 'Save Link'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
