import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export default function Settings() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [displayName, setDisplayName] = useState('');
  const [roleTitle, setRoleTitle] = useState('');
  const [companyContext, setCompanyContext] = useState('');
  const [draftingPrefs, setDraftingPrefs] = useState('');
  const [preferredProjects, setPreferredProjects] = useState('');
  const [notesForAi, setNotesForAi] = useState('');

  useEffect(() => {
    if (authLoading) return;
    if (!user) { navigate('/auth'); return; }

    const load = async () => {
      const { data } = await supabase
        .from('user_profiles_extended')
        .select()
        .eq('user_id', user.id)
        .single();

      if (data) {
        setDisplayName(data.display_name ?? '');
        setRoleTitle(data.role_title ?? '');
        setCompanyContext(data.company_context_summary ?? '');
        setDraftingPrefs(data.drafting_preferences ?? '');
        setPreferredProjects((data.preferred_projects ?? []).join(', '));
        setNotesForAi(data.notes_for_ai ?? '');
      }
      setLoading(false);
    };
    load();
  }, [user, authLoading, navigate]);

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);

    const projects = preferredProjects
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const { error } = await supabase.from('user_profiles_extended').upsert(
      {
        user_id: user.id,
        display_name: displayName || null,
        role_title: roleTitle || null,
        company_context_summary: companyContext || null,
        drafting_preferences: draftingPrefs || null,
        preferred_projects: projects.length ? projects : null,
        notes_for_ai: notesForAi || null,
      },
      { onConflict: 'user_id' }
    );

    setSaving(false);
    if (error) {
      toast.error('Failed to save profile');
      console.error(error);
    } else {
      toast.success('Profile saved');
    }
  };

  if (authLoading || loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <Button variant="ghost" size="sm" className="mb-6 gap-2" onClick={() => navigate('/')}>
          <ArrowLeft className="h-4 w-4" />
          Back to Chat
        </Button>

        <Card>
          <CardHeader>
            <CardTitle>Profile & AI Preferences</CardTitle>
            <CardDescription>
              These preferences help the AI tailor responses to your role, projects, and writing style.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="displayName">Display Name</Label>
                <Input id="displayName" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="e.g. John" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="roleTitle">Role / Title</Label>
                <Input id="roleTitle" value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} placeholder="e.g. VP of Development" />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="companyContext">Company Context Summary</Label>
              <Textarea id="companyContext" value={companyContext} onChange={(e) => setCompanyContext(e.target.value)} placeholder="Brief description of your company and what it does…" rows={3} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="draftingPrefs">Drafting Preferences</Label>
              <Textarea id="draftingPrefs" value={draftingPrefs} onChange={(e) => setDraftingPrefs(e.target.value)} placeholder="e.g. Use formal tone, include citations, prefer bullet points…" rows={3} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="preferredProjects">Preferred Projects</Label>
              <Input id="preferredProjects" value={preferredProjects} onChange={(e) => setPreferredProjects(e.target.value)} placeholder="Comma-separated, e.g. Grace Valley, Riverside Phase 2" />
              <p className="text-xs text-muted-foreground">Projects you work with most often. The AI will prioritize these.</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notesForAi">Notes for AI</Label>
              <Textarea id="notesForAi" value={notesForAi} onChange={(e) => setNotesForAi(e.target.value)} placeholder="Any additional context or instructions for the AI…" rows={3} />
            </div>

            <Button onClick={handleSave} disabled={saving} className="w-full sm:w-auto gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save Preferences
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
