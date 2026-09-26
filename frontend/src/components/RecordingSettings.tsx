import React, { useState, useEffect } from 'react';
import { Switch } from '@/components/ui/switch';
import { FolderCog, FolderOpen, AppWindow, Volume2, RefreshCw, Check } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { DeviceSelection, SelectedDevices } from '@/components/DeviceSelection';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import Analytics from '@/lib/analytics';
import { toast } from 'sonner';
import { useConfig } from '@/contexts/ConfigContext';

export interface RecordableApp {
  id: string;
  name: string;
  executable: string;
  pid: number | null;
  has_audio: boolean;
  icon: string | null;
}

export interface RecordingPreferences {
  save_folder: string;
  auto_save: boolean;
  file_format: string;
  preferred_mic_device: string | null;
  preferred_system_device: string | null;
  /** Extra mic loudness after normalize (0.5–3.0). */
  mic_gain?: number;
  /** System-audio gain before metering, transcription, and recording (0.5–3.0). */
  system_gain?: number;
  per_app_recording_enabled?: boolean;
  per_app_target_app?: string | null;
  per_app_target_name?: string | null;
}

interface RecordingSettingsProps {
  onSave?: (preferences: RecordingPreferences) => void;
}

export function RecordingSettings({ onSave }: RecordingSettingsProps) {
  const { updateRecordingsLocation } = useConfig();
  const [preferences, setPreferences] = useState<RecordingPreferences>({
    save_folder: '',
    auto_save: true,
    file_format: 'mp4',
    preferred_mic_device: null,
    preferred_system_device: null,
    mic_gain: 1.0,
    system_gain: 1.0,
    per_app_recording_enabled: false,
    per_app_target_app: null,
    per_app_target_name: null,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isChoosingFolder, setIsChoosingFolder] = useState(false);
  const [showRecordingNotification, setShowRecordingNotification] = useState(true);
  const [recordableApps, setRecordableApps] = useState<RecordableApp[]>([]);
  const [loadingApps, setLoadingApps] = useState(false);

  // Load recording preferences on component mount
  useEffect(() => {
    const loadPreferences = async () => {
      try {
        const prefs = await invoke<RecordingPreferences>('get_recording_preferences');
        setPreferences(prefs);
      } catch (error) {
        console.error('Failed to load recording preferences:', error);
        // If loading fails, get default folder path
        try {
          const defaultPath = await invoke<string>('get_default_recordings_folder_path');
          setPreferences(prev => ({ ...prev, save_folder: defaultPath }));
        } catch (defaultError) {
          console.error('Failed to get default folder path:', defaultError);
        }
      } finally {
        setLoading(false);
      }
    };

    loadPreferences();
  }, []);

  // Load recording notification preference
  useEffect(() => {
    const loadNotificationPref = async () => {
      try {
        const { Store } = await import('@tauri-apps/plugin-store');
        const store = await Store.load('preferences.json');
        const show = await store.get<boolean>('show_recording_notification') ?? true;
        setShowRecordingNotification(show);
      } catch (error) {
        console.error('Failed to load notification preference:', error);
      }
    };
    loadNotificationPref();
  }, []);

  const loadRecordableApps = async () => {
    setLoadingApps(true);
    try {
      const apps = await invoke<RecordableApp[]>('get_recordable_apps');
      setRecordableApps(apps);
    } catch (err) {
      console.error('Failed to load recordable apps:', err);
    } finally {
      setLoadingApps(false);
    }
  };

  useEffect(() => {
    if (preferences.per_app_recording_enabled) {
      loadRecordableApps();
    }
  }, [preferences.per_app_recording_enabled]);

  const handlePerAppToggle = async (enabled: boolean) => {
    const newPreferences = {
      ...preferences,
      per_app_recording_enabled: enabled,
    };
    setPreferences(newPreferences);
    await savePreferences(newPreferences);
    if (enabled && recordableApps.length === 0) {
      loadRecordableApps();
    }
  };

  const handleAppSelect = async (executable: string) => {
    const selected = recordableApps.find(a => a.executable === executable);
    const targetName = selected ? selected.name : executable;
    const newPreferences = {
      ...preferences,
      per_app_target_app: executable,
      per_app_target_name: targetName,
    };
    setPreferences(newPreferences);
    await savePreferences(newPreferences);
  };

  const handleBrowseExecutable = async () => {
    try {
      const app = await invoke<RecordableApp | null>('select_custom_app_executable');
      if (app) {
        setRecordableApps(prev => {
          if (!prev.some(a => a.executable.toLowerCase() === app.executable.toLowerCase())) {
            return [app, ...prev];
          }
          return prev;
        });
        const newPreferences = {
          ...preferences,
          per_app_target_app: app.executable,
          per_app_target_name: app.name,
        };
        setPreferences(newPreferences);
        await savePreferences(newPreferences);
        toast.success(`Selected application: ${app.name}`);
      }
    } catch (err) {
      console.error('Failed to select custom app executable:', err);
      toast.error('Could not select application executable');
    }
  };

  const handleAutoSaveToggle = async (enabled: boolean) => {
    const newPreferences = { ...preferences, auto_save: enabled };
    setPreferences(newPreferences);
    await savePreferences(newPreferences);

    // Track auto-save setting change
    await Analytics.track('auto_save_recording_toggled', {
      enabled: enabled.toString()
    });
  };

  const handleMicGainChange = async (value: number) => {
    const mic_gain = Math.min(3, Math.max(0.5, value));
    const newPreferences = { ...preferences, mic_gain };
    setPreferences(newPreferences);
    await savePreferences(newPreferences);
  };

  const handleSystemGainChange = async (value: number) => {
    const system_gain = Math.min(3, Math.max(0.5, value));
    const newPreferences = { ...preferences, system_gain };
    setPreferences(newPreferences);
    await savePreferences(newPreferences);
  };

  const handleDeviceChange = async (devices: SelectedDevices) => {
    const newPreferences = {
      ...preferences,
      preferred_mic_device: devices.micDevice,
      preferred_system_device: devices.systemDevice
    };
    setPreferences(newPreferences);
    await savePreferences(newPreferences);

    // Track default device preference changes
    // Note: Individual device selection analytics are tracked in DeviceSelection component
    await Analytics.track('default_devices_changed', {
      has_preferred_microphone: (!!devices.micDevice).toString(),
      has_preferred_system_audio: (!!devices.systemDevice).toString()
    });
  };

  const handleOpenFolder = async () => {
    try {
      await invoke('open_recordings_folder');
    } catch (error) {
      console.error('Failed to open recordings folder:', error);
      toast.error('Could not open recordings folder', {
        description: String(error),
      });
    }
  };

  const handleChangeFolder = async () => {
    if (isChoosingFolder) return;

    setIsChoosingFolder(true);
    try {
      const selectedFolder = await invoke<string | null>('select_recording_folder');
      if (!selectedFolder) return;

      const newPreferences = { ...preferences, save_folder: selectedFolder };
      await invoke('set_recording_preferences', { preferences: newPreferences });
      setPreferences(newPreferences);
      updateRecordingsLocation(selectedFolder);
      onSave?.(newPreferences);
      toast.success('Recordings folder updated');
      Analytics.track('recordings_folder_changed', { source: 'recording_settings' }).catch(console.error);
    } catch (error) {
      console.error('Failed to change recordings folder:', error);
      toast.error('Could not update recordings folder', {
        description: String(error),
      });
    } finally {
      setIsChoosingFolder(false);
    }
  };

  const handleNotificationToggle = async (enabled: boolean) => {
    try {
      setShowRecordingNotification(enabled);
      const { Store } = await import('@tauri-apps/plugin-store');
      const store = await Store.load('preferences.json');
      await store.set('show_recording_notification', enabled);
      await store.save();
      toast.success('Preference saved');
      await Analytics.track('recording_notification_preference_changed', {
        enabled: enabled.toString()
      });
    } catch (error) {
      console.error('Failed to save notification preference:', error);
      toast.error('Failed to save preference');
    }
  };

  const savePreferences = async (prefs: RecordingPreferences) => {
    setSaving(true);
    try {
      await invoke('set_recording_preferences', { preferences: prefs });
      onSave?.(prefs);

      // Show success toast with device details
      const micDevice = prefs.preferred_mic_device || 'Default';
      const systemDevice = prefs.preferred_system_device || 'Default';
      toast.success("Device preferences saved", {
        description: `Microphone: ${micDevice}, System Audio: ${systemDevice}`
      });
    } catch (error) {
      console.error('Failed to save recording preferences:', error);
      toast.error("Failed to save device preferences", {
        description: error instanceof Error ? error.message : String(error)
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-1/4 mb-4"></div>
        <div className="h-8 bg-gray-200 rounded mb-4"></div>
      </div>
    );
  }

  return (
    <div className="min-w-0 max-w-full space-y-6">
      <div className="min-w-0">
        <h3 className="mb-4 text-lg font-semibold">Recording Settings</h3>
        <p className="mb-6 text-sm text-gray-600">
          Configure how your audio recordings are saved during meetings.
        </p>
      </div>

      {/* Auto Save Toggle */}
      <div className="flex min-w-0 items-start justify-between gap-3 rounded-lg border p-4 sm:items-center">
        <div className="min-w-0 flex-1">
          <div className="font-medium">Save Audio Recordings</div>
          <div className="text-sm text-gray-600">
            Automatically save audio files when recording stops
          </div>
        </div>
        <Switch
          checked={preferences.auto_save}
          onCheckedChange={handleAutoSaveToggle}
          disabled={saving}
          className="shrink-0"
        />
      </div>

      {/* Mic gain — boost local voice after loudness normalize */}
      <div className="min-w-0 space-y-3 rounded-lg border p-4">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="font-medium">Microphone gain</div>
            <div className="text-sm text-gray-600 break-words">
              Boost your voice if it sounds quiet next to system audio (0.5×–3×)
            </div>
          </div>
          <span className="shrink-0 text-sm font-semibold tabular-nums text-[var(--af-text)]">
            {(preferences.mic_gain ?? 1).toFixed(1)}×
          </span>
        </div>
        <input
          type="range"
          min={0.5}
          max={3}
          step={0.1}
          value={preferences.mic_gain ?? 1}
          disabled={saving}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            setPreferences((p) => ({ ...p, mic_gain: v }));
          }}
          onMouseUp={(e) => void handleMicGainChange(parseFloat((e.target as HTMLInputElement).value))}
          onTouchEnd={(e) => void handleMicGainChange(parseFloat((e.target as HTMLInputElement).value))}
          onBlur={(e) => void handleMicGainChange(parseFloat(e.target.value))}
          className="w-full min-w-0 max-w-full accent-[var(--af-accent,#4a8bff)]"
        />
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
          <span>Quieter</span>
          <button
            type="button"
            className="underline hover:text-gray-800"
            disabled={saving}
            onClick={() => void handleMicGainChange(1)}
          >
            Reset 1.0×
          </button>
          <span>Louder</span>
        </div>
      </div>

      {/* System gain — applied before meters, transcription, and saved tracks */}
      <div className="min-w-0 space-y-3 rounded-lg border p-4">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="font-medium">System audio gain</div>
            <div className="text-sm text-gray-600 break-words">
              Balance other participants and computer audio (0.5×–3×)
            </div>
          </div>
          <span className="shrink-0 text-sm font-semibold tabular-nums text-[var(--af-text)]">
            {(preferences.system_gain ?? 1).toFixed(1)}×
          </span>
        </div>
        <input
          type="range"
          min={0.5}
          max={3}
          step={0.1}
          value={preferences.system_gain ?? 1}
          disabled={saving}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            setPreferences((p) => ({ ...p, system_gain: v }));
          }}
          onMouseUp={(e) => void handleSystemGainChange(parseFloat((e.target as HTMLInputElement).value))}
          onTouchEnd={(e) => void handleSystemGainChange(parseFloat((e.target as HTMLInputElement).value))}
          onBlur={(e) => void handleSystemGainChange(parseFloat(e.target.value))}
          className="w-full min-w-0 max-w-full accent-[var(--af-accent,#4a8bff)]"
        />
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
          <span>Quieter</span>
          <button
            type="button"
            className="underline hover:text-gray-800"
            disabled={saving}
            onClick={() => void handleSystemGainChange(1)}
          >
            Reset 1.0×
          </button>
          <span>Louder</span>
        </div>
        <p className="text-xs text-amber-700">
          If boosted audio repeatedly hits the safety limiter, the live system meter warns you to lower this gain or playback volume.
        </p>
      </div>

      {/* Folder Location - Only shown when auto_save is enabled */}
      {preferences.auto_save && (
        <div className="min-w-0 space-y-4">
          <div className="min-w-0 rounded-lg border bg-gray-50 p-4">
            <div className="mb-2 font-medium">Save Location</div>
            <div className="mb-3 break-all text-sm text-gray-600">
              {preferences.save_folder || 'Default folder'}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={handleChangeFolder}
                disabled={isChoosingFolder || saving}
                className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
              >
                <FolderCog className="w-4 h-4" />
                {isChoosingFolder ? 'Choosing...' : 'Change Folder'}
              </button>
              <button
                onClick={handleOpenFolder}
                disabled={isChoosingFolder}
                className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
              >
                <FolderOpen className="w-4 h-4" />
                Open Folder
              </button>
            </div>
          </div>

          <div className="p-4 border rounded-lg bg-blue-50">
            <div className="text-sm text-blue-800">
              <strong>File Format:</strong> {preferences.file_format.toUpperCase()} files
            </div>
            <div className="text-xs text-blue-600 mt-1">
              Recordings are saved with timestamp: recording_YYYYMMDD_HHMMSS.{preferences.file_format}
            </div>
          </div>
        </div>
      )}

      {/* Info when auto_save is disabled */}
      {!preferences.auto_save && (
        <div className="p-4 border rounded-lg bg-yellow-50">
          <div className="text-sm text-yellow-800">
            Audio recording is disabled. Enable "Save Audio Recordings" to automatically save your meeting audio.
          </div>
        </div>
      )}

      {/* Device Preferences */}
      <div className="space-y-4">
        <div className="border-t pt-6">
          <h4 className="text-base font-medium text-gray-900 mb-4">Default Audio Devices</h4>
          <p className="text-sm text-gray-600 mb-4">
            Set your preferred microphone and system audio devices for recording. These will be automatically selected when starting new recordings.
          </p>

          <div className="border rounded-lg p-4 bg-gray-50">
            <DeviceSelection
              selectedDevices={{
                micDevice: preferences.preferred_mic_device,
                systemDevice: preferences.preferred_system_device
              }}
              onDeviceChange={handleDeviceChange}
              disabled={saving}
            />
            {preferences.per_app_recording_enabled && preferences.per_app_target_app && (
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50/80 px-3 py-2 text-xs text-blue-700">
                <AppWindow className="h-3.5 w-3.5 shrink-0 text-blue-600" />
                <span>
                  Per-app recording is active for <strong>{preferences.per_app_target_name || preferences.per_app_target_app}</strong>. System audio will capture this app only.
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Per-App Audio Recording */}
      <div className="space-y-4">
        <div className="border-t pt-6">
          <div className="flex min-w-0 items-start justify-between gap-3 sm:items-center">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 font-medium text-gray-900">
                <AppWindow className="h-4 w-4 text-[var(--af-accent,#4a8bff)]" />
                <span>Per-App Audio Recording</span>
              </div>
              <div className="text-sm text-gray-600">
                Only record audio from a specific application or executable (e.g. Zoom, Microsoft Teams, Slack, Chrome) instead of capturing all system sound.
              </div>
            </div>
            <Switch
              checked={preferences.per_app_recording_enabled ?? false}
              onCheckedChange={handlePerAppToggle}
              disabled={saving}
              className="shrink-0"
            />
          </div>

          {preferences.per_app_recording_enabled && (
            <div className="mt-4 space-y-4 rounded-lg border bg-gray-50 p-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="per-app-select" className="text-sm font-medium text-gray-700">
                    Target Application
                  </Label>
                  <button
                    type="button"
                    onClick={loadRecordableApps}
                    disabled={loadingApps || saving}
                    className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 disabled:opacity-50"
                  >
                    <RefreshCw className={`h-3 w-3 ${loadingApps ? 'animate-spin' : ''}`} />
                    Refresh apps
                  </button>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <div className="flex-1">
                    <Select
                      value={preferences.per_app_target_app || ''}
                      onValueChange={handleAppSelect}
                      disabled={loadingApps || saving}
                    >
                      <SelectTrigger id="per-app-select" className="w-full bg-white">
                        <SelectValue placeholder={loadingApps ? "Scanning running apps..." : "Select an application..."} />
                      </SelectTrigger>
                      <SelectContent className="max-h-72">
                        {recordableApps.length === 0 && !loadingApps && (
                          <SelectItem value="none" disabled>
                            No active applications found
                          </SelectItem>
                        )}
                        {recordableApps.map((app) => (
                          <SelectItem key={`${app.id}-${app.pid || ''}`} value={app.executable}>
                            <div className="flex items-center justify-between gap-3 w-full">
                              <span className="font-medium">{app.name}</span>
                              <div className="flex items-center gap-2">
                                {app.has_audio && (
                                  <span className="inline-flex items-center gap-1 rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-800">
                                    <Volume2 className="h-2.5 w-2.5" /> Sound Active
                                  </span>
                                )}
                                <span className="text-xs text-gray-400 font-mono">
                                  {app.executable}
                                </span>
                              </div>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <button
                    type="button"
                    onClick={handleBrowseExecutable}
                    disabled={saving}
                    className="flex items-center justify-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    title="Browse for custom executable"
                  >
                    <FolderOpen className="h-4 w-4" />
                    <span>Browse...</span>
                  </button>
                </div>

                {preferences.per_app_target_app && (
                  <div className="mt-2 flex items-center gap-2 rounded-md border border-blue-100 bg-blue-50 p-2.5 text-xs text-blue-800">
                    <Check className="h-4 w-4 text-blue-600 shrink-0" />
                    <div>
                      Recording isolated audio from{' '}
                      <span className="font-semibold">
                        {preferences.per_app_target_name || preferences.per_app_target_app}
                      </span>{' '}
                      (<span className="font-mono">{preferences.per_app_target_app}</span>). All other background music, notification sounds, and apps will be excluded.
                    </div>
                  </div>
                )}

                {!preferences.per_app_target_app && (
                  <p className="text-xs text-amber-600">
                    Please select an application or browse for an executable to isolate its audio.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
