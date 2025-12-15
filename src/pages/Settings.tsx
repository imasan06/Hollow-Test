import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ArrowLeft, Save, RotateCcw, Plus, Copy, Trash2, Edit2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { 
  getAllPresets, 
  getActivePreset, 
  setActivePreset, 
  createPreset, 
  updatePreset, 
  deletePreset, 
  duplicatePreset,
  resetSettings,
  type PersonaPreset 
} from '@/storage/settingsStore';

export function Settings() {
  const navigate = useNavigate();
  const [presets, setPresets] = useState<PersonaPreset[]>([]);
  const [activePresetId, setActivePresetId] = useState<string>('');
  const [currentPreset, setCurrentPreset] = useState<PersonaPreset | null>(null);
  const [persona, setPersona] = useState('');
  const [rules, setRules] = useState('');
  const [baserules, setBaserules] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  
  // Dialog states
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [presetToDelete, setPresetToDelete] = useState<string | null>(null);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      setIsLoading(true);
      const allPresets = await getAllPresets();
      const active = await getActivePreset();
      
      setPresets(allPresets);
      setActivePresetId(active.id);
      setCurrentPreset(active);
      setPersona(active.persona || '');
      setRules(active.rules || '');
      setBaserules(active.baseRules || '');
    } catch (error) {
      console.error('[Settings] Failed to load settings:', error);
      toast({
        title: 'Error',
        description: 'Failed to load settings',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handlePresetChange = async (presetId: string) => {
    try {
      await setActivePreset(presetId);
      const preset = presets.find(p => p.id === presetId);
      if (preset) {
        setActivePresetId(presetId);
        setCurrentPreset(preset);
        setPersona(preset.persona || '');
        setRules(preset.rules || '');
        setBaserules(preset.baseRules || '');
        toast({
          title: 'Preset Changed',
          description: `Switched to "${preset.name}"`,
        });
      }
    } catch (error) {
      console.error('[Settings] Failed to change preset:', error);
      toast({
        title: 'Error',
        description: 'Failed to change preset',
        variant: 'destructive',
      });
    }
  };

  const handleSave = async () => {
    if (!currentPreset) return;
    
    try {
      setIsSaving(true);
      
      await updatePreset(currentPreset.id, {
        persona: persona.trim(),
        rules: rules.trim(),
        baseRules: baserules.trim(),
      });
      
      // Reload to get updated preset
      await loadSettings();
      
      toast({
        title: 'Settings Saved',
        description: `"${currentPreset.name}" has been saved`,
      });
    } catch (error) {
      console.error('[Settings] Failed to save settings:', error);
      toast({
        title: 'Error',
        description: 'Failed to save settings',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = async () => {
    if (!currentPreset) return;
    
    if (!confirm(`Reset "${currentPreset.name}" to defaults? This cannot be undone.`)) {
      return;
    }

    try {
      await resetSettings();
      await loadSettings();
      toast({
        title: 'Preset Reset',
        description: `"${currentPreset.name}" has been reset to defaults`,
      });
    } catch (error) {
      console.error('[Settings] Failed to reset preset:', error);
      toast({
        title: 'Error',
        description: 'Failed to reset preset',
        variant: 'destructive',
      });
    }
  };

  const handleNewPreset = async () => {
    try {
      const newPreset = await createPreset('New Preset');
      await setActivePreset(newPreset.id);
      await loadSettings();
      toast({
        title: 'Preset Created',
        description: `Created "${newPreset.name}"`,
      });
    } catch (error) {
      console.error('[Settings] Failed to create preset:', error);
      toast({
        title: 'Error',
        description: 'Failed to create preset',
        variant: 'destructive',
      });
    }
  };

  const handleDuplicatePreset = async () => {
    if (!currentPreset) return;
    
    try {
      const duplicated = await duplicatePreset(currentPreset.id);
      await setActivePreset(duplicated.id);
      await loadSettings();
      toast({
        title: 'Preset Duplicated',
        description: `Created "${duplicated.name}"`,
      });
    } catch (error) {
      console.error('[Settings] Failed to duplicate preset:', error);
      toast({
        title: 'Error',
        description: 'Failed to duplicate preset',
        variant: 'destructive',
      });
    }
  };

  const handleRenamePreset = async () => {
    if (!currentPreset || !newName.trim()) return;
    
    try {
      await updatePreset(currentPreset.id, { name: newName.trim() });
      setRenameDialogOpen(false);
      setNewName('');
      await loadSettings();
      toast({
        title: 'Preset Renamed',
        description: `Renamed to "${newName.trim()}"`,
      });
    } catch (error) {
      console.error('[Settings] Failed to rename preset:', error);
      toast({
        title: 'Error',
        description: 'Failed to rename preset',
        variant: 'destructive',
      });
    }
  };

  const handleDeletePreset = async () => {
    if (!presetToDelete) return;
    
    try {
      await deletePreset(presetToDelete);
      setDeleteConfirmOpen(false);
      setPresetToDelete(null);
      await loadSettings();
      toast({
        title: 'Preset Deleted',
        description: 'Preset has been deleted',
      });
    } catch (error) {
      console.error('[Settings] Failed to delete preset:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to delete preset',
        variant: 'destructive',
      });
    }
  };

  const openRenameDialog = () => {
    if (currentPreset) {
      setNewName(currentPreset.name);
      setRenameDialogOpen(true);
    }
  };

  const openDeleteDialog = () => {
    if (currentPreset) {
      setPresetToDelete(currentPreset.id);
      setDeleteConfirmOpen(true);
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Loading settings...</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background safe-area-top">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur-sm safe-area-top">
        <div className="container flex h-16 items-center gap-4 px-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/')}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="font-semibold text-foreground">Settings</h1>
            <p className="text-xs text-muted-foreground">Configure AI persona and rules</p>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container flex-1 py-8 px-4 max-w-4xl mx-auto">
        <div className="space-y-8">
          {/* Preset Selector Card */}
          <Card className="border-border/60 shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg">Persona Presets</CardTitle>
              <CardDescription className="text-sm">
                Create and manage multiple AI persona presets. The active preset is used for all AI requests.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col sm:flex-row gap-2">
                <Select value={activePresetId} onValueChange={handlePresetChange}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Select a preset" />
                  </SelectTrigger>
                  <SelectContent>
                    {presets.map((preset) => (
                      <SelectItem key={preset.id} value={preset.id}>
                        {preset.name}
                        {preset.id === activePresetId && ' (Active)'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={handleNewPreset}
                    title="New Preset"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={handleDuplicatePreset}
                    disabled={!currentPreset}
                    title="Duplicate Preset"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={openRenameDialog}
                    disabled={!currentPreset}
                    title="Rename Preset"
                  >
                    <Edit2 className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={openDeleteDialog}
                    disabled={!currentPreset || presets.length <= 1}
                    title="Delete Preset"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Persona Card */}
          <Card className="border-border/60 shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg">AI Persona</CardTitle>
              <CardDescription className="text-sm">
                Define how the AI should behave and respond. This persona is sent with every request.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="persona">Persona Description</Label>
                <Textarea
                  id="persona"
                  placeholder="You are a helpful AI assistant for the Hollow Watch..."
                  value={persona}
                  onChange={(e) => setPersona(e.target.value)}
                  rows={6}
                  className="font-mono text-sm bg-background/50 border-border/60 focus:border-primary/50"
                />
                <p className="text-xs text-muted-foreground">
                  This text is included in every AI request to define the assistant's behavior.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Rules Card */}
          <Card className="border-border/60 shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg">Rules</CardTitle>
              <CardDescription className="text-sm">
                Optional rules that override or extend the base persona behavior.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="rules">Custom Rules</Label>
                <Textarea
                  id="rules"
                  placeholder="Enter custom rules (optional)..."
                  value={rules}
                  onChange={(e) => setRules(e.target.value)}
                  rows={4}
                  className="font-mono text-sm bg-background/50 border-border/60 focus:border-primary/50"
                />
              </div>
            </CardContent>
          </Card>

          {/* Base Rules Card */}
          <Card className="border-border/60 shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg">Base Rules</CardTitle>
              <CardDescription className="text-sm">
                Fundamental rules that apply before persona and custom rules.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="baserules">Base Rules</Label>
                <Textarea
                  id="baserules"
                  placeholder="Enter base rules (optional)..."
                  value={baserules}
                  onChange={(e) => setBaserules(e.target.value)}
                  rows={4}
                  className="font-mono text-sm bg-background/50 border-border/60 focus:border-primary/50"
                />
              </div>
            </CardContent>
          </Card>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <Button
              onClick={handleSave}
              disabled={isSaving}
              className="flex-1 h-11"
            >
              <Save className="h-4 w-4 mr-2" />
              Save Settings
            </Button>
            <Button
              variant="outline"
              onClick={handleReset}
              disabled={isSaving}
              className="h-11"
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              Reset
            </Button>
          </div>

          {/* Info */}
          <Card className="bg-muted/30 border-border/60 shadow-sm">
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground leading-relaxed">
                <strong className="text-foreground/90">Note:</strong> Settings are stored locally on your device. The active preset is automatically
                included with every AI request. You can also receive persona updates from the watch via BLE.
              </p>
            </CardContent>
          </Card>
        </div>
      </main>

      {/* Rename Dialog */}
      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Preset</DialogTitle>
            <DialogDescription>
              Enter a new name for this preset.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Preset name"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleRenamePreset();
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleRenamePreset} disabled={!newName.trim()}>
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Preset</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{currentPreset?.name}"? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeletePreset}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

