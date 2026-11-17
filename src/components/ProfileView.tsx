import React, { useEffect, useId, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  Check,
  ChevronRight,
  Code2,
  Download,
  HardDrive,
  HelpCircle,
  History,
  Info,
  Lock,
  Pencil,
  PenTool,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
  User,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
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
import { buildWorkspaceBackup, estimateWorkspaceBytes } from '../utils/workspaceBackup';
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

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function initialsFromName(name: string): string {
  const initials = (name || 'BS')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() || '')
    .join('');
  return initials || 'BS';
}

const ActionRow: React.FC<{
  icon: LucideIcon;
  accent: string;
  title: string;
  description: string;
  onClick: () => void;
  testId?: string;
  badge?: React.ReactNode;
  trailing?: React.ReactNode;
}> = ({ icon: Icon, accent, title, description, onClick, testId, badge, trailing }) => (
  <button
    type="button"
    onClick={onClick}
    data-testid={testId}
    className="group flex min-h-[60px] w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 active:bg-slate-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-teal-600 cursor-pointer"
  >
    <div className="flex min-w-0 items-center gap-3">
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${accent}`}
      >
        <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <span className="truncate">{title}</span>
          {badge}
        </div>
        <div className="line-clamp-2 text-xs text-slate-500 sm:line-clamp-1">{description}</div>
      </div>
    </div>
    <div className="flex shrink-0 items-center gap-2">
      {trailing}
      <ChevronRight
        className="h-4 w-4 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-slate-400"
        aria-hidden="true"
      />
    </div>
  </button>
);

const HeroStat: React.FC<{ value: string | number; label: string }> = ({ value, label }) => (
  <div className="min-w-0 px-1">
    <div className="font-mono-tabular truncate text-sm font-bold text-slate-900 sm:text-base">
      {value}
    </div>
    <div className="mt-0.5 truncate text-[10px] font-medium text-slate-500 sm:text-[11px]">
      {label}
    </div>
  </div>
);

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
  const formId = useId();
  const [editingProfile, setEditingProfile] = useState(false);
  const [nameDraft, setNameDraft] = useState(settings.displayName);
  const [handleDraft, setHandleDraft] = useState(settings.accountHandle);
  const [emailDraft, setEmailDraft] = useState(settings.email);
  const [colorDraft, setColorDraft] = useState(settings.avatarColor || '#0d9488');
  const [emailError, setEmailError] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  const [backupNotice, setBackupNotice] = useState('');
  const [storageEstimate, setStorageEstimate] = useState<{ usage: number; quota: number } | null>(
    null
  );

  const totalPages = useMemo(
    () => documents.reduce((acc, d) => acc + d.pages.length, 0),
    [documents]
  );

  const estimatedBytes = useMemo(
    () => estimateWorkspaceBytes(documents, savedSignatures),
    [documents, savedSignatures]
  );

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

  const initials = initialsFromName(settings.displayName);

  useEffect(() => {
    let cancelled = false;
    const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined;
    if (!storage?.estimate) return;
    storage
      .estimate()
      .then((estimate) => {
        if (cancelled) return;
        if (
          typeof estimate.usage === 'number' &&
          typeof estimate.quota === 'number' &&
          estimate.quota > 0
        ) {
          setStorageEstimate({ usage: estimate.usage, quota: estimate.quota });
        }
      })
      .catch(() => {
        /* quota is optional information, never block the page for it */
      });
    return () => {
      cancelled = true;
    };
  }, [documents, savedSignatures]);

  useEffect(() => {
    if (!editingProfile) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        haptics.tap();
        setEmailError('');
        setEditingProfile(false);
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
    // haptics.tap is a stable useCallback; keying on the object would re-subscribe every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingProfile]);

  const storagePercent = storageEstimate
    ? Math.min(100, Math.max(1, (storageEstimate.usage / storageEstimate.quota) * 100))
    : 0;

  const openEditProfile = () => {
    haptics.tap();
    setNameDraft(settings.displayName);
    setHandleDraft(settings.accountHandle);
    setEmailDraft(settings.email);
    setColorDraft(settings.avatarColor || '#0d9488');
    setEmailError('');
    setEditingProfile(true);
  };

  const cancelEditProfile = () => {
    haptics.tap();
    setEmailError('');
    setEditingProfile(false);
  };

  const saveProfile = (event?: React.FormEvent) => {
    event?.preventDefault();
    const trimmedEmail = emailDraft.trim();
    if (trimmedEmail && !EMAIL_PATTERN.test(trimmedEmail)) {
      setEmailError('Enter a valid email, like you@example.com');
      return;
    }
    haptics.success();
    onUpdateSettings({
      displayName: nameDraft.trim() || 'Local Workspace',
      accountHandle: sanitizeAccountHandle(handleDraft),
      email: trimmedEmail || settings.email,
      avatarColor: colorDraft,
    });
    setEmailError('');
    setEditingProfile(false);
  };

  const handleExportBackupJson = () => {
    haptics.tap();
    const payload = buildWorkspaceBackup(settings, documents, savedSignatures);
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
      className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-4 py-5 pb-24 sm:p-6 lg:p-8"
    >
      {/* Local Account Identity Card */}
      <section className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xs">
        <div
          className="pointer-events-none absolute inset-0 bg-gradient-to-br from-teal-50 via-white to-sky-50/70"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full bg-teal-200/25 blur-3xl"
          aria-hidden="true"
        />

        <div className="relative p-4 sm:p-6">
          {editingProfile ? (
            <form onSubmit={saveProfile} noValidate className="animate-sheet-up">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold text-slate-900">Edit local profile</h2>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Only stored in this browser. Nothing is uploaded.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={cancelEditProfile}
                  aria-label="Cancel editing profile"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-500 transition-colors hover:bg-white hover:text-slate-900 cursor-pointer"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label
                    htmlFor={`${formId}-name`}
                    className="mb-1 block text-xs font-semibold text-slate-600"
                  >
                    Display Name
                  </label>
                  <input
                    id={`${formId}-name`}
                    type="text"
                    value={nameDraft}
                    maxLength={40}
                    onChange={(e) => setNameDraft(e.target.value)}
                    data-testid="profile-name-input"
                    autoComplete="name"
                    autoFocus
                    className="min-h-[44px] w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-teal-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label
                    htmlFor={`${formId}-handle`}
                    className="mb-1 block text-xs font-semibold text-slate-600"
                  >
                    Handle
                  </label>
                  <input
                    id={`${formId}-handle`}
                    type="text"
                    value={handleDraft}
                    maxLength={25}
                    onChange={(e) => setHandleDraft(e.target.value)}
                    placeholder="@bitscan_user"
                    data-testid="profile-handle-input"
                    autoComplete="username"
                    className="min-h-[44px] w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-teal-600 focus:outline-none"
                  />
                  <p className="mt-1 truncate text-[11px] text-slate-400">
                    Saved as{' '}
                    <span className="font-semibold text-slate-600">
                      {sanitizeAccountHandle(handleDraft)}
                    </span>
                  </p>
                </div>
                <div>
                  <label
                    htmlFor={`${formId}-email`}
                    className="mb-1 block text-xs font-semibold text-slate-600"
                  >
                    Email
                  </label>
                  <input
                    id={`${formId}-email`}
                    type="email"
                    value={emailDraft}
                    maxLength={80}
                    onChange={(e) => {
                      setEmailDraft(e.target.value);
                      if (emailError) setEmailError('');
                    }}
                    data-testid="profile-email-input"
                    autoComplete="email"
                    aria-invalid={Boolean(emailError)}
                    aria-describedby={emailError ? `${formId}-email-error` : undefined}
                    className={`min-h-[44px] w-full rounded-xl border bg-white px-3 text-sm text-slate-900 focus:outline-none ${
                      emailError
                        ? 'border-red-300 focus:border-red-500'
                        : 'border-slate-200 focus:border-teal-600'
                    }`}
                  />
                  {emailError ? (
                    <p id={`${formId}-email-error`} className="mt-1 text-[11px] text-red-600">
                      {emailError}
                    </p>
                  ) : (
                    <p className="mt-1 text-[11px] text-slate-400">Never uploaded anywhere</p>
                  )}
                </div>
              </div>

              <div className="mt-4 border-t border-slate-200/80 pt-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="mr-1 text-xs font-semibold text-slate-600">Badge Color</span>
                  {AVATAR_COLOR_OPTIONS.map((color) => {
                    const selected = colorDraft === color.id;
                    return (
                      <button
                        key={color.id}
                        type="button"
                        onClick={() => setColorDraft(color.id)}
                        aria-label={`${color.label} badge color`}
                        aria-pressed={selected}
                        className={`flex h-8 w-8 items-center justify-center rounded-full border-2 transition-transform cursor-pointer ${
                          selected
                            ? 'scale-110 border-slate-900 shadow-xs'
                            : 'border-transparent hover:scale-105'
                        }`}
                        style={{ backgroundColor: color.id }}
                      >
                        {selected && <Check className="h-4 w-4 text-white" aria-hidden="true" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2 sm:flex sm:justify-end">
                <button
                  type="button"
                  onClick={cancelEditProfile}
                  data-testid="profile-cancel-btn"
                  className="min-h-[44px] rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  data-testid="profile-save-btn"
                  className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-teal-600 px-4 text-xs font-bold text-white hover:bg-teal-700 active:scale-[0.98] transition-all cursor-pointer"
                >
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  Save changes
                </button>
              </div>
            </form>
          ) : (
            <>
              <div className="flex items-start gap-3.5 sm:gap-4">
                <div
                  className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-lg font-bold text-white shadow-md shadow-slate-900/15 ring-1 ring-black/10 sm:h-16 sm:w-16 sm:text-xl"
                  style={{ backgroundColor: settings.avatarColor || '#0d9488' }}
                >
                  {initials || <User className="h-6 w-6 sm:h-7 sm:w-7" aria-hidden="true" />}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <h1 className="truncate text-lg font-bold tracking-tight text-slate-900 sm:text-2xl">
                      {settings.displayName}
                    </h1>
                    <button
                      type="button"
                      onClick={openEditProfile}
                      data-testid="profile-edit-btn"
                      className="inline-flex min-h-[34px] shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-white/90 px-2.5 sm:px-3 text-xs font-semibold text-slate-700 shadow-xs transition-colors hover:bg-white hover:text-slate-900 cursor-pointer"
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                      <span className="hidden sm:inline">Edit Profile</span>
                      <span className="sm:hidden">Edit</span>
                    </button>
                  </div>

                  <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs">
                    <span className="shrink-0 font-semibold text-teal-700">
                      {settings.accountHandle}
                    </span>
                    <span className="shrink-0 text-slate-400" aria-hidden="true">
                      ·
                    </span>
                    <span className="min-w-0 truncate text-slate-500">{settings.email}</span>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] font-medium text-slate-500">
                    <span className="inline-flex items-center gap-1 font-semibold text-teal-700">
                      <Lock className="h-3 w-3 shrink-0" aria-hidden="true" />
                      <span>Local-only</span>
                    </span>
                    <span className="text-slate-300" aria-hidden="true">
                      •
                    </span>
                    <span className="inline-flex items-center gap-1 text-slate-500">
                      <CalendarDays className="h-3 w-3 shrink-0 text-slate-400" aria-hidden="true" />
                      <span>Since {memberSince}</span>
                    </span>
                  </div>
                </div>
              </div>

              {/* Workspace Summary Numbers */}
              <div className="mt-4 grid grid-cols-4 divide-x divide-slate-200/80 rounded-2xl border border-slate-200/80 bg-slate-50/75 py-2.5 text-center">
                <HeroStat
                  value={documents.length}
                  label={documents.length === 1 ? 'Project' : 'Projects'}
                />
                <HeroStat value={totalPages} label={totalPages === 1 ? 'Page' : 'Pages'} />
                <HeroStat value={savedSignatures.length} label="Signatures" />
                <HeroStat value={formatByteSize(estimatedBytes)} label="Storage" />
              </div>

              {storageEstimate && (
                <div className="mt-3.5">
                  <div className="flex items-center justify-between gap-3 text-[11px] font-medium text-slate-500">
                    <span className="inline-flex items-center gap-1.5">
                      <HardDrive className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                      Browser storage
                    </span>
                    <span className="font-mono-tabular shrink-0 text-slate-500">
                      {formatByteSize(storageEstimate.usage)} of{' '}
                      {formatByteSize(storageEstimate.quota)}
                    </span>
                  </div>
                  <div
                    className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-slate-200/80"
                    role="progressbar"
                    aria-label="Browser storage used"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(storagePercent)}
                  >
                    <div
                      className="h-full rounded-full bg-teal-500"
                      style={{ width: `${storagePercent}%` }}
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </section>

      {/* PWA Install Card */}
      <PWAInstallButton variant="card" />

      {/* Workspace */}
      <div className="flex flex-col gap-2">
        <h2 className="px-1 text-[11px] font-bold uppercase tracking-wider text-slate-500">
          Workspace
        </h2>
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white divide-y divide-slate-100">
          <ActionRow
            icon={Settings}
            accent="bg-teal-50 text-teal-700"
            title="Settings"
            description="Capture, export defaults, OCR language & confirmations"
            onClick={() => {
              haptics.tap();
              onOpenSettings();
            }}
            testId="profile-open-settings-btn"
          />
          <ActionRow
            icon={PenTool}
            accent="bg-violet-50 text-violet-700"
            title="My E-Signatures"
            description="Create or manage saved signatures & paper stamps"
            badge={
              savedSignatures.length > 0 ? (
                <span className="font-mono-tabular rounded-full bg-violet-50 px-1.5 py-0.5 text-[10px] font-bold text-violet-700">
                  {savedSignatures.length}
                </span>
              ) : undefined
            }
            onClick={() => {
              haptics.tap();
              onOpenSignatures();
            }}
          />
          <ActionRow
            icon={Download}
            accent="bg-sky-50 text-sky-700"
            title="Export local backup"
            description={
              backupNotice || `Everything as JSON · about ${formatByteSize(estimatedBytes)}`
            }
            onClick={handleExportBackupJson}
            testId="profile-backup-btn"
            trailing={
              <span className="hidden rounded-md border border-slate-200 px-1.5 py-0.5 font-mono-tabular text-[10px] font-semibold text-slate-500 sm:inline">
                .JSON
              </span>
            }
          />
          <ActionRow
            icon={Sparkles}
            accent="bg-amber-50 text-amber-600"
            title="Welcome setup tour"
            description="Replay the guided profile & default filter setup"
            onClick={() => {
              haptics.tap();
              onReplayOnboarding();
            }}
            testId="profile-replay-onboarding-btn"
          />
        </section>
      </div>

      {/* Learn & Support */}
      <div className="flex flex-col gap-2">
        <h2 className="px-1 text-[11px] font-bold uppercase tracking-wider text-slate-500">
          Learn &amp; Support
        </h2>
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white divide-y divide-slate-100">
          <ActionRow
            icon={Info}
            accent="bg-slate-100 text-slate-600"
            title="About bitscanner"
            description="What this app does & how it stays private"
            onClick={() => {
              haptics.tap();
              onOpenInfoPage('about');
            }}
            testId="profile-about-btn"
            trailing={
              <span className="font-mono-tabular text-[11px] font-semibold text-slate-400">
                v{APP_VERSION}
              </span>
            }
          />
          <ActionRow
            icon={History}
            accent="bg-slate-100 text-slate-600"
            title="Release notes & changelog"
            description="What changed in each version"
            onClick={() => {
              haptics.tap();
              onOpenInfoPage('release_notes');
            }}
            testId="profile-releases-btn"
          />
          <ActionRow
            icon={Lock}
            accent="bg-slate-100 text-slate-600"
            title="Privacy & offline storage"
            description="Where your scans live and who can see them"
            onClick={() => {
              haptics.tap();
              onOpenInfoPage('privacy');
            }}
            testId="profile-privacy-btn"
          />
          <ActionRow
            icon={HelpCircle}
            accent="bg-slate-100 text-slate-600"
            title="Help & touch gestures"
            description="Shortcuts, gestures and common questions"
            onClick={() => {
              haptics.tap();
              onOpenInfoPage('help');
            }}
            testId="profile-help-btn"
          />
          <ActionRow
            icon={Code2}
            accent="bg-slate-100 text-slate-600"
            title="Android Kotlin blueprint"
            description="Peek at the native app architecture notes"
            onClick={() => {
              haptics.tap();
              onOpenKotlinModal();
            }}
          />
        </section>
      </div>

      {/* Danger Zone */}
      <div className="flex flex-col gap-2">
        <h2 className="px-1 text-[11px] font-bold uppercase tracking-wider text-red-500/90">
          Danger zone
        </h2>
        <section className="rounded-2xl border border-red-200 bg-red-50/50 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-100 text-red-600">
                <AlertTriangle className="h-[18px] w-[18px]" aria-hidden="true" />
              </span>
              <div>
                <div className="text-sm font-semibold text-red-950">Erase local workspace</div>
                <div className="mt-0.5 text-xs text-red-800/80">
                  Deletes every project &amp; signature in this browser, then restores the three
                  sample documents. This cannot be undone.
                </div>
              </div>
            </div>

            {!confirmReset ? (
              <button
                type="button"
                onClick={() => {
                  haptics.tap();
                  setConfirmReset(true);
                }}
                data-testid="profile-reset-btn"
                className="min-h-[40px] shrink-0 rounded-xl border border-red-200 bg-white px-3.5 text-xs font-semibold text-red-700 hover:bg-red-50 cursor-pointer"
              >
                Reset
              </button>
            ) : (
              <div className="flex shrink-0 items-center justify-start gap-1.5 sm:justify-end">
                <button
                  type="button"
                  onClick={() => setConfirmReset(false)}
                  className="min-h-[40px] rounded-xl border border-red-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmReset(false);
                    onResetLocalWorkspace();
                  }}
                  data-testid="profile-reset-confirm-btn"
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-red-600 px-3.5 text-xs font-bold text-white hover:bg-red-700 active:scale-[0.98] transition-all cursor-pointer"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Delete all</span>
                </button>
              </div>
            )}
          </div>
        </section>
      </div>

      <p className="flex items-center justify-center gap-1.5 px-2 pb-1 text-center text-[11px] text-slate-400">
        <ShieldCheck className="h-3.5 w-3.5 text-teal-600/70" aria-hidden="true" />
        Scans, OCR and signatures never leave this device.
      </p>
    </div>
  );
};
