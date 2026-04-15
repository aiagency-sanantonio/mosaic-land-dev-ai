import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

export interface WebLink {
  id: string;
  name: string;
  url: string;
  project_name: string | null;
  categories: string[];
  notes: string | null;
  added_by: string;
  created_at: string;
  updated_at: string;
  is_active: boolean;
  last_researched_at: string | null;
}

export const LINK_CATEGORIES = [
  'Vendor',
  'Consultant',
  'Government',
  'Utility',
  'Reference',
  'Permit',
  'Legal',
  'Other',
] as const;

export function useWebLinks(search?: string, categoryFilter?: string) {
  return useQuery({
    queryKey: ['web-links', search, categoryFilter],
    queryFn: async () => {
      let query = supabase
        .from('saved_web_links')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (search) {
        query = query.or(
          `name.ilike.%${search}%,url.ilike.%${search}%,project_name.ilike.%${search}%,notes.ilike.%${search}%`
        );
      }

      if (categoryFilter) {
        query = query.contains('categories', [categoryFilter]);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as WebLink[];
    },
  });
}

export function useAddWebLink() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (link: {
      name: string;
      url: string;
      project_name?: string;
      categories: string[];
      notes?: string;
    }) => {
      if (!user) throw new Error('Not authenticated');
      const { data, error } = await supabase.from('saved_web_links').insert({
        name: link.name,
        url: link.url,
        project_name: link.project_name || null,
        categories: link.categories,
        notes: link.notes || null,
        added_by: user.id,
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['web-links'] });
      toast.success('Link saved successfully');
    },
    onError: (err: Error) => {
      toast.error(`Failed to save link: ${err.message}`);
    },
  });
}

export function useDeleteWebLink() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('saved_web_links')
        .update({ is_active: false })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['web-links'] });
      toast.success('Link removed');
    },
    onError: (err: Error) => {
      toast.error(`Failed to remove link: ${err.message}`);
    },
  });
}
