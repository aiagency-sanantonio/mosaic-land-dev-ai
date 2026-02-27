
-- Create chat_folders table
CREATE TABLE public.chat_folders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.chat_folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own folders" ON public.chat_folders FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own folders" ON public.chat_folders FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own folders" ON public.chat_folders FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own folders" ON public.chat_folders FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_chat_folders_updated_at
  BEFORE UPDATE ON public.chat_folders
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Add folder_id to chat_threads
ALTER TABLE public.chat_threads
  ADD COLUMN folder_id UUID REFERENCES public.chat_folders(id) ON DELETE SET NULL;
