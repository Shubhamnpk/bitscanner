import React, { useState } from 'react';
import {
  ChevronRight,
  Code2,
  PenTool,
  Settings,
  Star,
  Trash2,
  User,
} from 'lucide-react';
import type { SavedSignature, ScanDocument } from '../types/scanner';
import type { AppSettings } from '../utils/settingsStore';
import { useHaptics } from '../hooks/useHaptics';

interface ProfileViewProps {
  settings: AppSettings;
  documents: ScanDocument[];
  savedSignatures: SavedSignature[];
  onUpdateSettings: (patch: Partial<AppSettings>) => void;
  onOpenSettings: () => void;
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
  onOpenSignatures,
  onOpenKotlinModal,
  onResetLocalWorkspace,
}) => {
  const haptics = useHaptics();
  const [editingProfile, setEditingProfile] = useState(false);
  const [nameDraft, setNameDraft] = useState(settings.displayName);
  const [emailDraft, setEmailDraft] = useState(settings.email);
  const [confirmReset, setConfirmReset] = useState(false);

  const totalPages = documents.reduce((acc, d) => acc + d.pages.length, 0);

  const initials = (settings.displayName || 'CS')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('');

  const saveProfile = () => {
    haptics.success();
    onUpdateSettings({
      displayName: nameDraft.trim() || 'CamScan User',
      email: emailDraft.trim() || settings.email,
    });
    setEditingProfile(false);
  };

  return (
    <div
      data-testid="profile-view"
      className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-4 py-5 pb-24 sm:p-6 lg:p-8"
    >
      {/* Profile Identity Card */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-teal-600 text-lg font-bold text-white">
              {initials || <User className="h-6 w-6" aria-hidden="true" />}
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-bold text-slate-900">
                {settings.displayName}
              </h1>
              <p className="truncate text-xs text-slate-500">{settings.email}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              haptics.tap();
              setNameDraft(settings.displayName);
              setEmailDraft(settings.email);
              setEditingProfile((v) => !v);
            }}
            className="shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            {editingProfile ? 'Cancel' : 'Edit'}
          </button>
        </div>

        {editingProfile && (
          <div className="mt-4 flex flex-col gap-3 border-t border-slate-100 pt-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Display Name</label>
                <input
                  type="text"
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
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
            <button
              type="button"
              onClick={saveProfile}
              className="self-start rounded-xl bg-teal-600 px-4 py-2 text-xs font-bold text-white hover:bg-teal-700 cursor-pointer"
            >
              Save Profile
            </button>
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
            <div className="font-mono-tabular text-base sm:text-lg font-bold text-slate-900">
              {settings.favoriteTools.length}
            </div>
            <div className="text-[11px] text-slate-500">Starred Tools</div>
          </div>
        </div>
      </section>

      {/* Native Mobile Settings & Navigation List */}
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
                Scan defaults, OCR language, PDF preferences &amp; haptics
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
          onClick={() => {
            haptics.tap();
            onOpenKotlinModal();
          }}
          className="flex w-full min-h-[58px] items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50 active:bg-slate-100 cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
              <Code2 className="h-4.5 w-4.5" aria-hidden="true" />
            </span>
            <div>
              <div className="text-sm font-semibold text-slate-900">Android Kotlin Source</div>
              <div className="text-xs text-slate-500">
                Inspect native Jetpack Compose &amp; OpenCV architecture blueprint
              </div>
            </div>
          </div>
          <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" aria-hidden="true" />
        </button>
      </section>

      {/* Workspace Data Controls */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
              <Star className="h-4.5 w-4.5" aria-hidden="true" />
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
              className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              Reset
            </button>
          ) : (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setConfirmReset(false)}
                className="rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmReset(false);
                  onResetLocalWorkspace();
                }}
                className="inline-flex items-center gap-1 rounded-xl bg-red-600 px-3 py-1.5 text-xs font-bold text-white cursor-pointer"
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
