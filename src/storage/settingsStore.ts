import { Preferences } from '@capacitor/preferences';
import { logger } from '@/utils/logger';

const SETTINGS_STORAGE_KEY = 'app_settings';
const DEFAULT_PERSONA = 'You are a helpful AI assistant for the Hollow Watch.';

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

  persona?: string;
  rules?: string;
  baserules?: string;
  lastUpdated?: number;
}


function generatePresetId(): string {
  return `preset_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}


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


async function migrateLegacySettings(legacy: LegacyAppSettings): Promise<AppSettings> {
  logger.debug('Migrating legacy settings to preset format', 'Settings');

  const defaultPreset = createDefaultPreset();

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


  await Preferences.set({
    key: SETTINGS_STORAGE_KEY,
    value: JSON.stringify(migrated),
  });

  logger.debug(`Migration complete, created default preset: ${defaultPreset.name}`, 'Settings');
  return migrated;
}


export async function getSettings(): Promise<AppSettings> {
  try {
    const { value } = await Preferences.get({ key: SETTINGS_STORAGE_KEY });

    if (!value) {

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


    if (!('personas' in settings) || !Array.isArray(settings.personas)) {
      return await migrateLegacySettings(settings as LegacyAppSettings);
    }

    if (!settings.personas || settings.personas.length === 0) {
      const defaultPreset = createDefaultPreset();
      settings.personas = [defaultPreset];
      settings.activePersonaId = defaultPreset.id;
      await Preferences.set({
        key: SETTINGS_STORAGE_KEY,
        value: JSON.stringify(settings),
      });
    }


    if (!settings.activePersonaId || !settings.personas.find(p => p.id === settings.activePersonaId)) {
      settings.activePersonaId = settings.personas[0].id;
      await Preferences.set({
        key: SETTINGS_STORAGE_KEY,
        value: JSON.stringify(settings),
      });
    }

    // Initialize persistent context persona ID if not set
    try {
      const { getPersistentContextPersonaId, setPersistentContextPersonaId } = await import('@/storage/conversationStore');
      const currentPersonaId = await getPersistentContextPersonaId();
      if (!currentPersonaId || currentPersonaId !== settings.activePersonaId) {
        // Set or update persona ID for persistent context
        await setPersistentContextPersonaId(settings.activePersonaId);
      }
    } catch (error) {
      // Non-critical - log but don't fail
      logger.debug('Could not initialize persistent context persona ID', 'Settings');
    }

    return settings;
  } catch (error) {
    logger.error('Error reading settings', 'Settings', error instanceof Error ? error : new Error(String(error)));

    const defaultPreset = createDefaultPreset();
    return {
      personas: [defaultPreset],
      activePersonaId: defaultPreset.id,
    };
  }
}


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

    logger.debug('Settings saved', 'Settings');
  } catch (error) {
    logger.error('Error saving settings', 'Settings', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}


export async function getActivePreset(): Promise<PersonaPreset> {
  const settings = await getSettings();
  const active = settings.personas.find(p => p.id === settings.activePersonaId);
  if (!active) {
    // Fallback to first preset if active not found
    return settings.personas[0] || createDefaultPreset();
  }
  return active;
}


export async function getPersona(): Promise<string> {
  const preset = await getActivePreset();
  return preset.persona || DEFAULT_PERSONA;
}


export async function getRules(): Promise<string | undefined> {
  const preset = await getActivePreset();
  return preset.rules || undefined;
}


export async function getBaserules(): Promise<string | undefined> {
  const preset = await getActivePreset();
  return preset.baseRules || undefined;
}

export async function getAllPresets(): Promise<PersonaPreset[]> {
  const settings = await getSettings();
  return settings.personas;
}

export async function getPresetById(id: string): Promise<PersonaPreset | null> {
  const settings = await getSettings();
  return settings.personas.find(p => p.id === id) || null;
}

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

  logger.debug(`Created new preset: ${newPreset.name}`, 'Settings');
  return newPreset;
}

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
  logger.debug(`Updated preset: ${settings.personas[index].name}`, 'Settings');
}


export async function deletePreset(id: string): Promise<void> {
  const settings = await getSettings();

  if (settings.personas.length <= 1) {
    throw new Error('Cannot delete the last preset');
  }

  settings.personas = settings.personas.filter(p => p.id !== id);


  if (settings.activePersonaId === id) {
    settings.activePersonaId = settings.personas[0].id;
  }

  await saveSettings(settings);
  logger.debug(`Deleted preset: ${id}`, 'Settings');
}


export async function setActivePreset(id: string): Promise<void> {
  const settings = await getSettings();
  const preset = settings.personas.find(p => p.id === id);

  if (!preset) {
    throw new Error(`Preset with id ${id} not found`);
  }

  // Check if persona is changing - if so, clear persistent context
  const { getPersistentContextPersonaId, clearPersistentContext, setPersistentContextPersonaId } = await import('@/storage/conversationStore');
  const currentPersonaId = await getPersistentContextPersonaId();
  
  if (currentPersonaId && currentPersonaId !== id) {
    // Persona is changing - clear persistent context for new persona
    await clearPersistentContext();
    logger.debug(`Persona changed from ${currentPersonaId} to ${id}, cleared persistent context`, 'Settings');
  }
  
  // Update persona ID for persistent context
  await setPersistentContextPersonaId(id);

  settings.activePersonaId = id;
  await saveSettings(settings);
  logger.debug(`Set active preset: ${preset.name}`, 'Settings');
}

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

  logger.debug(`Duplicated preset: ${source.name} -> ${duplicated.name}`, 'Settings');
  return duplicated;
}


export async function upsertPresetByName(presetData: Partial<PersonaPreset> & { name: string }): Promise<PersonaPreset> {
  const settings = await getSettings();
  const existing = settings.personas.find(p => p.name === presetData.name);

  if (existing) {
    const updated: PersonaPreset = {
      ...existing,
      ...presetData,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
    };

    const index = settings.personas.findIndex(p => p.id === existing.id);
    settings.personas[index] = updated;
    await saveSettings(settings);

    logger.debug(`Updated preset by name: ${presetData.name}`, 'Settings');
    return updated;
  } else {

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

    logger.debug(`Created preset by name: ${presetData.name}`, 'Settings');
    return newPreset;
  }
}


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
      logger.debug('Reset active preset to defaults', 'Settings');
    }
  } catch (error) {
    logger.error('Error resetting settings', 'Settings', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}

