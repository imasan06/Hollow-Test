/**
 * Settings Storage
 * 
 * Manages persistent settings including AI persona/rules.
 * Uses Capacitor Preferences for cross-platform persistence.
 * Supports multiple persona presets with active preset selection.
 */

import { Preferences } from '@capacitor/preferences';

const SETTINGS_STORAGE_KEY = 'app_settings';
const DEFAULT_PERSONA = 'You are a helpful AI assistant for the Hollow Watch.';

// Legacy interface for migration
interface LegacyAppSettings {
  persona?: string;
  rules?: string;
  baserules?: string;
  lastUpdated?: number;
}

export interface PersonaPreset {
  id: string;
  name: string;
  persona: string;
  rules: string;
  baseRules: string;
  updatedAt: number;
  createdAt: number;
}

export interface AppSettings {
  personas: PersonaPreset[];
  activePersonaId: string;
  // Legacy fields kept for backward compatibility during migration
  persona?: string;
  rules?: string;
  baserules?: string;
  lastUpdated?: number;
}

/**
 * Generate a unique ID for a preset
 */
function generatePresetId(): string {
  return `preset_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Create default preset
 */
function createDefaultPreset(): PersonaPreset {
  const now = Date.now();
  return {
    id: generatePresetId(),
    name: 'Default',
    persona: DEFAULT_PERSONA,
    rules: '',
    baseRules: '',
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Migrate legacy settings to new preset format
 */
async function migrateLegacySettings(legacy: LegacyAppSettings): Promise<AppSettings> {
  console.log('[Settings] Migrating legacy settings to preset format');
  
  const defaultPreset = createDefaultPreset();
  
  // If legacy persona exists, use it
  if (legacy.persona) {
    defaultPreset.persona = legacy.persona;
  }
  if (legacy.rules) {
    defaultPreset.rules = legacy.rules;
  }
  if (legacy.baserules) {
    defaultPreset.baseRules = legacy.baserules;
  }
  
  const migrated: AppSettings = {
    personas: [defaultPreset],
    activePersonaId: defaultPreset.id,
  };
  
  // Save migrated settings
  await Preferences.set({
    key: SETTINGS_STORAGE_KEY,
    value: JSON.stringify(migrated),
  });
  
  console.log('[Settings] Migration complete, created default preset:', defaultPreset.name);
  return migrated;
}

/**
 * Get all settings with automatic migration
 */
export async function getSettings(): Promise<AppSettings> {
  try {
    const { value } = await Preferences.get({ key: SETTINGS_STORAGE_KEY });
    
    if (!value) {
      // No settings exist, create default preset
      const defaultSettings: AppSettings = {
        personas: [createDefaultPreset()],
        activePersonaId: '',
      };
      defaultSettings.activePersonaId = defaultSettings.personas[0].id;
      await Preferences.set({
        key: SETTINGS_STORAGE_KEY,
        value: JSON.stringify(defaultSettings),
      });
      return defaultSettings;
    }

    const settings: AppSettings | LegacyAppSettings = JSON.parse(value);
    
    // Check if this is legacy format (has persona but no personas array)
    if (!('personas' in settings) || !Array.isArray(settings.personas)) {
      return await migrateLegacySettings(settings as LegacyAppSettings);
    }
    
    // Ensure we have at least one preset
    if (!settings.personas || settings.personas.length === 0) {
      const defaultPreset = createDefaultPreset();
      settings.personas = [defaultPreset];
      settings.activePersonaId = defaultPreset.id;
      await Preferences.set({
        key: SETTINGS_STORAGE_KEY,
        value: JSON.stringify(settings),
      });
    }
    
    // Ensure activePersonaId is valid
    if (!settings.activePersonaId || !settings.personas.find(p => p.id === settings.activePersonaId)) {
      settings.activePersonaId = settings.personas[0].id;
      await Preferences.set({
        key: SETTINGS_STORAGE_KEY,
        value: JSON.stringify(settings),
      });
    }

    return settings;
  } catch (error) {
    console.error('[Settings] Error reading settings:', error);
    // Return safe defaults on error
    const defaultPreset = createDefaultPreset();
    return {
      personas: [defaultPreset],
      activePersonaId: defaultPreset.id,
    };
  }
}

/**
 * Save settings
 */
export async function saveSettings(settings: Partial<AppSettings>): Promise<void> {
  try {
    const current = await getSettings();
    const updated: AppSettings = {
      ...current,
      ...settings,
    };

    await Preferences.set({
      key: SETTINGS_STORAGE_KEY,
      value: JSON.stringify(updated),
    });

    console.log('[Settings] Settings saved:', {
      presetCount: updated.personas?.length || 0,
      activePersonaId: updated.activePersonaId,
    });
  } catch (error) {
    console.error('[Settings] Error saving settings:', error);
    throw error;
  }
}

/**
 * Get active persona preset
 */
export async function getActivePreset(): Promise<PersonaPreset> {
  const settings = await getSettings();
  const active = settings.personas.find(p => p.id === settings.activePersonaId);
  if (!active) {
    // Fallback to first preset if active not found
    return settings.personas[0] || createDefaultPreset();
  }
  return active;
}

/**
 * Get persona string from active preset (backward compatibility)
 */
export async function getPersona(): Promise<string> {
  const preset = await getActivePreset();
  return preset.persona || DEFAULT_PERSONA;
}

/**
 * Get rules from active preset (backward compatibility)
 */
export async function getRules(): Promise<string | undefined> {
  const preset = await getActivePreset();
  return preset.rules || undefined;
}

/**
 * Get baserules from active preset (backward compatibility)
 */
export async function getBaserules(): Promise<string | undefined> {
  const preset = await getActivePreset();
  return preset.baseRules || undefined;
}

/**
 * Get all presets
 */
export async function getAllPresets(): Promise<PersonaPreset[]> {
  const settings = await getSettings();
  return settings.personas;
}

/**
 * Get preset by ID
 */
export async function getPresetById(id: string): Promise<PersonaPreset | null> {
  const settings = await getSettings();
  return settings.personas.find(p => p.id === id) || null;
}

/**
 * Create a new preset
 */
export async function createPreset(name: string): Promise<PersonaPreset> {
  const settings = await getSettings();
  const newPreset: PersonaPreset = {
    id: generatePresetId(),
    name: name.trim() || 'New Preset',
    persona: DEFAULT_PERSONA,
    rules: '',
    baseRules: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  
  settings.personas.push(newPreset);
  await saveSettings(settings);
  
  console.log('[Settings] Created new preset:', newPreset.name);
  return newPreset;
}

/**
 * Update a preset
 */
export async function updatePreset(id: string, updates: Partial<Omit<PersonaPreset, 'id' | 'createdAt'>>): Promise<void> {
  const settings = await getSettings();
  const index = settings.personas.findIndex(p => p.id === id);
  
  if (index === -1) {
    throw new Error(`Preset with id ${id} not found`);
  }
  
  settings.personas[index] = {
    ...settings.personas[index],
    ...updates,
    updatedAt: Date.now(),
  };
  
  await saveSettings(settings);
  console.log('[Settings] Updated preset:', settings.personas[index].name);
}

/**
 * Delete a preset
 */
export async function deletePreset(id: string): Promise<void> {
  const settings = await getSettings();
  
  if (settings.personas.length <= 1) {
    throw new Error('Cannot delete the last preset');
  }
  
  settings.personas = settings.personas.filter(p => p.id !== id);
  
  // If deleted preset was active, switch to first preset
  if (settings.activePersonaId === id) {
    settings.activePersonaId = settings.personas[0].id;
  }
  
  await saveSettings(settings);
  console.log('[Settings] Deleted preset:', id);
}

/**
 * Set active preset
 */
export async function setActivePreset(id: string): Promise<void> {
  const settings = await getSettings();
  const preset = settings.personas.find(p => p.id === id);
  
  if (!preset) {
    throw new Error(`Preset with id ${id} not found`);
  }
  
  settings.activePersonaId = id;
  await saveSettings(settings);
  console.log('[Settings] Set active preset:', preset.name);
}

/**
 * Duplicate a preset
 */
export async function duplicatePreset(id: string, newName?: string): Promise<PersonaPreset> {
  const settings = await getSettings();
  const source = settings.personas.find(p => p.id === id);
  
  if (!source) {
    throw new Error(`Preset with id ${id} not found`);
  }
  
  const duplicated: PersonaPreset = {
    ...source,
    id: generatePresetId(),
    name: newName || `${source.name} (Copy)`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  
  settings.personas.push(duplicated);
  await saveSettings(settings);
  
  console.log('[Settings] Duplicated preset:', source.name, '->', duplicated.name);
  return duplicated;
}

/**
 * Upsert preset by name (for BLE SET_PERSONA_JSON)
 */
export async function upsertPresetByName(presetData: Partial<PersonaPreset> & { name: string }): Promise<PersonaPreset> {
  const settings = await getSettings();
  const existing = settings.personas.find(p => p.name === presetData.name);
  
  if (existing) {
    // Update existing
    const updated: PersonaPreset = {
      ...existing,
      ...presetData,
      id: existing.id, // Keep original ID
      createdAt: existing.createdAt, // Keep original creation time
      updatedAt: Date.now(),
    };
    
    const index = settings.personas.findIndex(p => p.id === existing.id);
    settings.personas[index] = updated;
    await saveSettings(settings);
    
    console.log('[Settings] Updated preset by name:', presetData.name);
    return updated;
  } else {
    // Create new
    const newPreset: PersonaPreset = {
      id: presetData.id || generatePresetId(),
      name: presetData.name,
      persona: presetData.persona || DEFAULT_PERSONA,
      rules: presetData.rules || '',
      baseRules: presetData.baseRules || '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    
    settings.personas.push(newPreset);
    await saveSettings(settings);
    
    console.log('[Settings] Created preset by name:', presetData.name);
    return newPreset;
  }
}

/**
 * Reset active preset to defaults (backward compatibility)
 */
export async function resetSettings(): Promise<void> {
  try {
    const settings = await getSettings();
    const active = settings.personas.find(p => p.id === settings.activePersonaId);
    
    if (active) {
      active.persona = DEFAULT_PERSONA;
      active.rules = '';
      active.baseRules = '';
      active.updatedAt = Date.now();
      await saveSettings(settings);
      console.log('[Settings] Reset active preset to defaults');
    }
  } catch (error) {
    console.error('[Settings] Error resetting settings:', error);
    throw error;
  }
}

