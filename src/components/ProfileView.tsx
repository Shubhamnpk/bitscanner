import React, { useMemo, useState } from 'react';
import {
  Check,
  ChevronRight,
  Code2,
  Download,
  HelpCircle,
  History,
  Info,
  Lock,
  PenTool,
  RotateCcw,
  Settings,
  Sparkles,
  Trash2,
  User,
} from 'lucide-react';
import type { SavedSignature, ScanDocument } from '../types/scanner';
import {
  APP_VERSION,
  AVATAR_COLOR_OPTIONS,
  formatByteSize,
  sanitizeAccountHandle,
  type AppSettings,
} from '../utils/settingsStore';
import type { InfoPageId } from './InfoPagesView';
import { PWAInstallButton } from './PWAInstallBanner';
import { useHaptics } from '../hooks/useHaptics';

interface ProfileViewProps {
  settings: AppSettings;
  documents: ScanDocument[];
  savedSignatures: SavedSignature[];
  onUpdateSettings: (patch: Partial<AppSettings>) => void;
  onOpenSettings: () => void;
  onOpenInfoPage: (page: InfoPageId) => void;
  onReplayOnboarding: () => void;
  onOpenSignatures: () => void;
  onOpenKotlinModal: () => void;
  onResetLocalWorkspace: () => void;
}

export const ProfileView: React.FC<ProfileViewProps> = ({
  settings,
  documents,
  savedSignatures,
  onUpdateSettings,
  onOpenSettings,
  onOpenInfoPage,
  onReplayOnboarding,
  onOpenSignatures,
  onOpenKotlinModal,
  onResetLocalWorkspace,
}) => {
  const haptics = useHaptics();
  const [editingProfile, setEditingProfile] = useState(false);
  const [nameDraft, setNameDraft] = useState(settings.displayName);
  const [handleDraft, setHandleDraft] = useState(settings.accountHandle);
  const [emailDraft, setEmailDraft] = useState(settings.email);
  const [colorDraft, setColorDraft] = useState(settings.avatarColor || '#0d9488');
  const [confirmReset, setConfirmReset] = useState(false);
  const [backupNotice, setBackupNotice] = useState('');

  const totalPages = useMemo(
    () => documents.reduce((acc, d) => acc + d.pages.length, 0),
    [documents]
  );

  const estimatedBytes = useMemo(() => {
    let bytes = 0;
    for (const doc of documents) {
      for (const page of doc.pages) {
        bytes += (page.originalDataUrl?.length || 0) * 0.75;
        bytes += (page.processedDataUrl?.length || 0) * 0.75;
        bytes += (page.ocrText?.length || 0) * 2;
      }
    }
    for (const sig of savedSignatures) {
      bytes += (sig.dataUrl?.length || 0) * 0.75;
    }
    return bytes;
  }, [documents, savedSignatures]);

  const memberSince = useMemo(() => {
    try {
      return new Date(settings.accountCreatedAt || Date.now()).toLocaleDateString(undefined, {
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return 'Local';
    }
  }, [settings.accountCreatedAt]);

  const initials = (settings.displayName || 'BS')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('');

  const saveProfile = () => {
    haptics.success();
    onUpdateSettings({
      displayName: nameDraft.trim() || 'Local Workspace',
      accountHandle: sanitizeAccountHandle(handleDraft),
      email: emailDraft.trim() || settings.email,
      avatarColor: colorDraft,
    });
    setEditingProfile(false);
  };

  const handleExportBackupJson = () => {
    haptics.tap();
    const payload = {
      app: 'bitscanner',
      version: APP_VERSION,
      exportedAt: new Date().toISOString(),
      account: {
        displayName: settings.displayName,
        accountHandle: settings.accountHandle,
        email: settings.email,
      },
      settings,
      documents,
      savedSignatures,
    };
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = window.document.createElement('a');
    a.href = url;
    a.download = `bitscanner-backup-${new Date().toISOString().slice(0, 10)}.json`;
    window.document.body.appendChild(a);
    a.click();
    window.document.body.removeChild(a);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setBackupNotice('Workspace JSON backup downloaded.');
    window.setTimeout(() => setBackupNotice(''), 2500);
  };

  return (
    <div
      data-testid="profile-view"
      className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-5 pb-24 sm:p-6 lg:p-8"
    >
      {/* Local Account Identity Card */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3.5 min-w-0">
            <div
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-lg font-bold text-white shadow-xs"
              style={{ backgroundColor: settings.avatarColor || '#0d9488' }}
            >
              {initials || <User className="h-6 w-6" aria-hidden="true" />}
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-bold text-slate-900">
                {settings.displayName}
              </h1>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
                <span className="font-semibold text-teal-700">{settings.accountHandle}</span>
                <span aria-hidden="true">·</span>
                <span className="truncate">{settings.email}</span>
              </div>
              <div className="mt-0.5 text-[11px] text-slate-400">
                Offline Local Account · Active {memberSince}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              haptics.tap();
              setNameDraft(settings.displayName);
              setHandleDraft(settings.accountHandle);
              setEmailDraft(settings.email);
              setColorDraft(settings.avatarColor || '#0d9488');
              setEditingProfile((v) => !v);
            }}
            data-testid="profile-edit-btn"
            className="min-h-[38px] shrink-0 rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            {editingProfile ? 'Cancel' : 'Edit Profile'}
          </button>
        </div>

        {editingProfile && (
          <div className="mt-4 flex flex-col gap-3 border-t border-slate-100 pt-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  Display Name
                </label>
                <input
                  type="text"
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  data-testid="profile-name-input"
                  className="w-full min-h-[42px] rounded-xl border border-slate-200 px-3 text-sm text-slate-900 focus:border-teal-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  Handle
                </label>
                <input
                  type="text"
                  value={handleDraft}
                  onChange={(e) => setHandleDraft(e.target.value)}
                  placeholder="@bitscan_user"
                  className="w-full min-h-[42px] rounded-xl border border-slate-200 px-3 text-sm text-slate-900 focus:border-teal-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Email</label>
                <input
                  type="email"
                  value={emailDraft}
                  onChange={(e) => setEmailDraft(e.target.value)}
                  className="w-full min-h-[42px] rounded-xl border border-slate-200 px-3 text-sm text-slate-900 focus:border-teal-600 focus:outline-none"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-slate-600">Badge Color:</span>
                {AVATAR_COLOR_OPTIONS.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setColorDraft(c.id)}
                    aria-label={`Select ${c.label} badge color`}
                    className={`flex h-7 w-7 items-center justify-center rounded-full border-2 cursor-pointer ${
                      colorDraft === c.id ? 'border-slate-900 scale-110' : 'border-transparent'
                    }`}
                    style={{ backgroundColor: c.id }}
                  >
                    {colorDraft === c.id && <Check className="h-3.5 w-3.5 text-white" />}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={saveProfile}
                data-testid="profile-save-btn"
                className="min-h-[40px] rounded-xl bg-teal-600 px-4 text-xs font-bold text-white hover:bg-teal-700 cursor-pointer"
              >
                Save Account
              </button>
            </div>
          </div>
        )}

        {/* Workspace Summary Numbers */}
        <div className="mt-5 grid grid-cols-4 gap-2 border-t border-slate-100 pt-4 text-center">
          <div>
            <div className="font-mono-tabular text-base sm:text-lg font-bold text-slate-900">
              {documents.length}
            </div>
            <div className="text-[11px] text-slate-500">Projects</div>
          </div>
          <div>
            <div className="font-mono-tabular text-base sm:text-lg font-bold text-slate-900">
              {totalPages}
            </div>
            <div className="text-[11px] text-slate-500">Pages</div>
          </div>
          <div>
            <div className="font-mono-tabular text-base sm:text-lg font-bold text-slate-900">
              {savedSignatures.length}
            </div>
            <div className="text-[11px] text-slate-500">Signatures</div>
          </div>
          <div>
            <div className="font-mono-tabular text-base sm:text-lg font-bold text-teal-700">
              {formatByteSize(estimatedBytes)}
            </div>
            <div className="text-[11px] text-slate-500">Local Size</div>
          </div>
        </div>
      </section>

      {/* PWA Install Card */}
      <PWAInstallButton variant="card" />

      {/* Primary Workspace Navigation */}
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white divide-y divide-slate-100">
        <button
          type="button"
          onClick={() => {
            haptics.tap();
            onOpenSettings();
          }}
          data-testid="profile-open-settings-btn"
          className="flex w-full min-h-[58px] items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50 active:bg-slate-100 cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
              <Settings className="h-4.5 w-4.5" aria-hidden="true" />
            </span>
            <div>
              <div className="text-sm font-semibold text-slate-900">Settings</div>
              <div className="text-xs text-slate-500">
                Auto-edge capture, export defaults, OCR language &amp; confirmations
              </div>
            </div>
          </div>
          <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={() => {
            haptics.tap();
            onOpenSignatures();
          }}
          className="flex w-full min-h-[58px] items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50 active:bg-slate-100 cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-50 text-violet-700">
              <PenTool className="h-4.5 w-4.5" aria-hidden="true" />
            </span>
            <div>
              <div className="text-sm font-semibold text-slate-900">My E-Signatures</div>
              <div className="text-xs text-slate-500">
                Create or manage saved signatures &amp; paper stamps
              </div>
            </div>
          </div>
          <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={handleExportBackupJson}
          data-testid="profile-backup-btn"
          className="flex w-full min-h-[58px] items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50 active:bg-slate-100 cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-50 text-sky-700">
              <Download className="h-4.5 w-4.5" aria-hidden="true" />
            </span>
            <div>
              <div className="text-sm font-semibold text-slate-900">
                Export Local Backup (.JSON)
              </div>
              <div className="text-xs text-slate-500">
                {backupNotice || 'Download all projects, signatures & preferences to your device'}
              </div>
            </div>
          </div>
          <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={() => {
            haptics.tap();
            onReplayOnboarding();
          }}
          data-testid="profile-replay-onboarding-btn"
          className="flex w-full min-h-[58px] items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50 active:bg-slate-100 cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
              <Sparkles className="h-4.5 w-4.5" aria-hidden="true" />
            </span>
            <div>
              <div className="text-sm font-semibold text-slate-900">Welcome Setup Tour</div>
              <div className="text-xs text-slate-500">
                Re-run the guided profile &amp; default filter setup
              </div>
            </div>
          </div>
          <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" aria-hidden="true" />
        </button>
      </section>

      {/* Essential Information Pages */}
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white divide-y divide-slate-100">
        <button
          type="button"
          onClick={() => {
            haptics.tap();
            onOpenInfoPage('about');
          }}
          data-testid="profile-about-btn"
          className="flex w-full min-h-[54px] items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-slate-50 cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <Info className="h-4.5 w-4.5 text-slate-500" aria-hidden="true" />
            <span className="text-sm font-medium text-slate-900">About bitscanner</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span className="font-mono-tabular">v{APP_VERSION}</span>
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </div>
        </button>

        <button
          type="button"
          onClick={() => {
            haptics.tap();
            onOpenInfoPage('release_notes');
          }}
          data-testid="profile-releases-btn"
          className="flex w-full min-h-[54px] items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-slate-50 cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <History className="h-4.5 w-4.5 text-slate-500" aria-hidden="true" />
            <span className="text-sm font-medium text-slate-900">Release Notes &amp; Changelog</span>
          </div>
          <ChevronRight className="h-4 w-4 text-slate-400" aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={() => {
            haptics.tap();
            onOpenInfoPage('privacy');
          }}
          data-testid="profile-privacy-btn"
          className="flex w-full min-h-[54px] items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-slate-50 cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <Lock className="h-4.5 w-4.5 text-slate-500" aria-hidden="true" />
            <span className="text-sm font-medium text-slate-900">Privacy &amp; Offline Storage</span>
          </div>
          <ChevronRight className="h-4 w-4 text-slate-400" aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={() => {
            haptics.tap();
            onOpenInfoPage('help');
          }}
          data-testid="profile-help-btn"
          className="flex w-full min-h-[54px] items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-slate-50 cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <HelpCircle className="h-4.5 w-4.5 text-slate-500" aria-hidden="true" />
            <span className="text-sm font-medium text-slate-900">Help &amp; Touch Gestures</span>
          </div>
          <ChevronRight className="h-4 w-4 text-slate-400" aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={() => {
            haptics.tap();
            onOpenKotlinModal();
          }}
          className="flex w-full min-h-[54px] items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-slate-50 cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <Code2 className="h-4.5 w-4.5 text-slate-500" aria-hidden="true" />
            <span className="text-sm font-medium text-slate-900">Android Kotlin Blueprint</span>
          </div>
          <ChevronRight className="h-4 w-4 text-slate-400" aria-hidden="true" />
        </button>
      </section>

      {/* Workspace Data Controls */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <div className="text-sm font-semibold text-slate-900">Reset Sample Documents</div>
              <div className="text-xs text-slate-500">
                Restore initial workspace documents &amp; clear local browser cache
              </div>
            </div>
          </div>
          {!confirmReset ? (
            <button
              type="button"
              onClick={() => setConfirmReset(true)}
              className="min-h-[38px] rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              Reset
            </button>
          ) : (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setConfirmReset(false)}
                className="min-h-[38px] rounded-xl border border-slate-200 px-2.5 text-xs font-medium text-slate-600 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmReset(false);
                  onResetLocalWorkspace();
                }}
                className="inline-flex min-h-[38px] items-center gap-1 rounded-xl bg-red-600 px-3 text-xs font-bold text-white cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Confirm</span>
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
