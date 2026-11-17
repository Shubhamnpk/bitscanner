import React, { useState } from 'react';
import {
  ArrowRight,
  Check,
  FileText,
  LayoutGrid,
  List,
  ShieldCheck,
  Sparkles,
  User,
} from 'lucide-react';
import type { FilterPreset } from '../types/scanner';
import {
  AVATAR_COLOR_OPTIONS,
  sanitizeAccountHandle,
  type AppSettings,
} from '../utils/settingsStore';
import { useHaptics } from '../hooks/useHaptics';

interface OnboardingFlowProps {
  isOpen: boolean;
  initialSettings: AppSettings;
  isReplay?: boolean;
  onComplete: (patch: Partial<AppSettings>) => void;
  onSkip: () => void;
}

const FILTER_CHOICES: Array<{ id: FilterPreset; label: string; desc: string }> = [
  { id: 'magic_color', label: 'Magic Color', desc: 'Balanced contrast & crisp white paper' },
  { id: 'bw_sharp', label: 'B&W Crisp', desc: 'High-contrast mono for text & forms' },
  { id: 'original', label: 'Original Photo', desc: 'Keep unadjusted camera tones' },
];

export const OnboardingFlow: React.FC<OnboardingFlowProps> = ({
  isOpen,
  initialSettings,
  isReplay = false,
  onComplete,
  onSkip,
}) => {
  const haptics = useHaptics();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [displayName, setDisplayName] = useState(
    initialSettings.displayName === 'Local Workspace' ? '' : initialSettings.displayName
  );
  const [accountHandle, setAccountHandle] = useState(
    initialSettings.accountHandle.replace(/^@/, '')
  );
  const [avatarColor, setAvatarColor] = useState(initialSettings.avatarColor || '#0d9488');
  const [defaultFilter, setDefaultFilter] = useState<FilterPreset>(initialSettings.defaultFilter);
  const [defaultLibraryView, setDefaultLibraryView] = useState<'grid' | 'list'>(
    initialSettings.defaultLibraryView
  );

  if (!isOpen) return null;

  const initials = (displayName.trim() || 'BS')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('');

  const finishSetup = () => {
    haptics.success();
    onComplete({
      displayName: displayName.trim() || 'Local Workspace',
      accountHandle: sanitizeAccountHandle(accountHandle || displayName || 'bitscan_user'),
      avatarColor,
      defaultFilter,
      defaultLibraryView,
      hasCompletedOnboarding: true,
      accountCreatedAt: initialSettings.accountCreatedAt || Date.now(),
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to bitscanner"
      data-testid="onboarding-flow-modal"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 p-0 sm:p-4 backdrop-blur-xs"
    >
      <div className="flex w-full sm:max-w-lg flex-col rounded-t-3xl sm:rounded-3xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl animate-sheet-up">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            {[1, 2, 3].map((dot) => (
              <span
                key={dot}
                className={`h-1.5 rounded-full transition-all ${
                  step === dot ? 'w-6 bg-teal-600' : 'w-2 bg-slate-200'
                }`}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={() => {
              haptics.tap();
              onSkip();
            }}
            data-testid="onboarding-skip-btn"
            className="min-h-[36px] rounded-xl px-2.5 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-900 cursor-pointer"
          >
            {isReplay ? 'Close' : 'Skip Setup'}
          </button>
        </div>

        {/* STEP 1: WELCOME */}
        {step === 1 && (
          <div className="mt-5 flex flex-col gap-4">
            <img
              src="/icon.svg"
              alt=""
              aria-hidden="true"
              className="h-12 w-12 rounded-2xl shadow-sm"
            />

            <div>
              <h2 className="text-xl font-bold tracking-tight text-slate-900">
                Welcome to bitscanner
              </h2>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
                Scan documents, ID cards, notes, and receipts completely offline in your browser
                or installed PWA with crisp perspective dewarping and multi-format export.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-2.5 rounded-2xl border border-slate-200 bg-slate-50 p-3.5">
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-teal-700" aria-hidden="true" />
                <div className="text-xs text-slate-700">
                  <strong className="font-semibold text-slate-900">100% On-Device Storage:</strong>{' '}
                  Scans, signatures, and OCR text stay strictly inside local IndexedDB.
                </div>
              </div>
              <div className="flex items-start gap-3">
                <FileText className="mt-0.5 h-4 w-4 shrink-0 text-teal-700" aria-hidden="true" />
                <div className="text-xs text-slate-700">
                  <strong className="font-semibold text-slate-900">PDF, Image &amp; Word Export:</strong>{' '}
                  Export single pages or full searchable PDF projects anytime.
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-teal-700" aria-hidden="true" />
                <div className="text-xs text-slate-700">
                  <strong className="font-semibold text-slate-900">Drag &amp; Long-Press Ready:</strong>{' '}
                  Reorder project pages effortlessly and edit annotations per page.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* STEP 2: CREATE LOCAL ACCOUNT */}
        {step === 2 && (
          <div className="mt-5 flex flex-col gap-4">
            <div className="flex items-center gap-3.5">
              <div
                className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-lg font-bold text-white shadow-sm"
                style={{ backgroundColor: avatarColor }}
              >
                {initials || <User className="h-6 w-6" aria-hidden="true" />}
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-900">Create Your Local Profile</h2>
                <p className="text-xs text-slate-500">
                  Personalizes your offline workspace &amp; default signature watermark stamp.
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Display Name
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="e.g. Alex Morgan"
                  data-testid="onboarding-name-input"
                  className="min-h-[44px] w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-900 focus:border-teal-600 focus:bg-white focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Workspace Handle
                </label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-400">
                    @
                  </span>
                  <input
                    type="text"
                    value={accountHandle.replace(/^@/, '')}
                    onChange={(e) => setAccountHandle(e.target.value)}
                    placeholder="alex_scans"
                    className="min-h-[44px] w-full rounded-xl border border-slate-200 bg-slate-50 pl-7 pr-3 text-sm font-medium text-slate-900 focus:border-teal-600 focus:bg-white focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                  Profile Color
                </label>
                <div className="flex items-center gap-2.5">
                  {AVATAR_COLOR_OPTIONS.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        haptics.tap();
                        setAvatarColor(c.id);
                      }}
                      aria-label={`Choose ${c.label} avatar color`}
                      className={`flex h-9 w-9 items-center justify-center rounded-full border-2 transition-transform cursor-pointer ${
                        avatarColor === c.id ? 'border-slate-900 scale-110' : 'border-transparent'
                      }`}
                      style={{ backgroundColor: c.id }}
                    >
                      {avatarColor === c.id && <Check className="h-4 w-4 text-white" aria-hidden="true" />}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* STEP 3: PREFERENCES */}
        {step === 3 && (
          <div className="mt-5 flex flex-col gap-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Preferred Scan Defaults</h2>
              <p className="text-xs text-slate-500">
                Change these anytime inside Profile &rarr; Settings.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <div className="text-xs font-semibold text-slate-700">Auto-Enhancement Filter</div>
              <div className="flex flex-col gap-1.5">
                {FILTER_CHOICES.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => {
                      haptics.tap();
                      setDefaultFilter(f.id);
                    }}
                    className={`flex min-h-[48px] items-center justify-between rounded-xl border px-3.5 text-left transition-colors cursor-pointer ${
                      defaultFilter === f.id
                        ? 'border-teal-600 bg-teal-50 text-teal-950'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <div>
                      <div className="text-xs font-bold">{f.label}</div>
                      <div className="text-[11px] text-slate-500">{f.desc}</div>
                    </div>
                    {defaultFilter === f.id && (
                      <Check className="h-4 w-4 shrink-0 text-teal-600" aria-hidden="true" />
                    )}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-1.5 text-xs font-semibold text-slate-700">Home Library View</div>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    { id: 'grid', label: 'Grid Cards', icon: LayoutGrid },
                    { id: 'list', label: 'Compact List', icon: List },
                  ] as const
                ).map((mode) => {
                  const Icon = mode.icon;
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => {
                        haptics.tap();
                        setDefaultLibraryView(mode.id);
                      }}
                      className={`flex min-h-[44px] items-center justify-center gap-2 rounded-xl border text-xs font-semibold cursor-pointer ${
                        defaultLibraryView === mode.id
                          ? 'border-teal-600 bg-teal-50 text-teal-900'
                          : 'border-slate-200 text-slate-700'
                      }`}
                    >
                      <Icon className="h-4 w-4" aria-hidden="true" />
                      <span>{mode.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Footer CTA */}
        <div className="mt-6 flex items-center justify-between gap-2 border-t border-slate-100 pt-4">
          {step > 1 ? (
            <button
              type="button"
              onClick={() => {
                haptics.tap();
                setStep((s) => (s === 3 ? 2 : 1));
              }}
              className="min-h-[44px] rounded-xl border border-slate-200 px-4 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              Back
            </button>
          ) : (
            <div />
          )}

          {step < 3 ? (
            <button
              type="button"
              onClick={() => {
                haptics.tap();
                setStep((s) => (s === 1 ? 2 : 3));
              }}
              data-testid="onboarding-next-btn"
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-teal-600 px-5 text-xs font-bold text-white hover:bg-teal-700 active:scale-[0.98] cursor-pointer"
            >
              <span>Continue</span>
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : (
            <button
              type="button"
              onClick={finishSetup}
              data-testid="onboarding-finish-btn"
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-teal-600 px-5 text-xs font-bold text-white hover:bg-teal-700 active:scale-[0.98] cursor-pointer"
            >
              <Check className="h-4 w-4" aria-hidden="true" />
              <span>{isReplay ? 'Save Preferences' : 'Start Scanning'}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
