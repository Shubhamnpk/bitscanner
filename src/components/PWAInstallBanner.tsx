import React, { useState } from 'react';
import { Check, Download, Share, Smartphone, WifiOff, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useHaptics } from '../hooks/useHaptics';

export const PWAInstallButton: React.FC<{ variant?: 'compact' | 'card' }> = ({
  variant = 'card',
}) => {
  const haptics = useHaptics();
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuideModal, setShowGuideModal] = useState(false);

  if (isInstalled) {
    if (variant === 'compact') return null;
    return (
      <div
        data-testid="pwa-installed-state"
        className="flex items-center justify-between gap-3 rounded-2xl border border-accent-line bg-accent-soft/70 px-4 py-3 text-accent-text"
      >
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-white">
            <Check className="h-4.5 w-4.5" aria-hidden="true" />
          </span>
          <div>
            <div className="text-sm font-bold">Installed as App</div>
            <div className="text-xs text-accent-text/80">
              Running in standalone offline-ready mode
            </div>
          </div>
        </div>
      </div>
    );
  }

  const handleAction = async () => {
    haptics.tap();
    if (isInstallable) {
      await install();
    } else {
      setShowGuideModal(true);
    }
  };

  return (
    <>
      {variant === 'compact' ? (
        <button
          type="button"
          onClick={handleAction}
          data-testid="pwa-install-btn"
          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-accent px-3.5 text-xs font-semibold text-white hover:bg-accent-strong active:scale-[0.98] transition-all cursor-pointer whitespace-nowrap shrink-0"
        >
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{isIOS ? 'Install on iOS' : 'Install App'}</span>
        </button>
      ) : (
        <div
          data-testid="pwa-install-card"
          className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-line bg-surface p-4"
        >
          <div className="flex items-center gap-3 min-w-0">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent-strong border border-accent-line">
              <Smartphone className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <div className="text-sm font-bold text-ink">Install bitscanner App</div>
              <div className="text-xs text-ink-muted">
                Add to home screen for full-screen scanning &amp; offline access
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={handleAction}
            data-testid="pwa-install-btn"
            className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-xs font-bold text-white hover:bg-accent-strong active:scale-[0.98] transition-all cursor-pointer whitespace-nowrap"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            <span>
              {isInstallable ? 'Install Now' : isIOS ? 'Add to Home Screen' : 'Install App'}
            </span>
          </button>
        </div>
      )}

      {showGuideModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Install bitscanner PWA instructions"
          data-testid="pwa-install-guide-dialog"
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/50 p-0 sm:p-4 backdrop-blur-xs"
          onClick={() => setShowGuideModal(false)}
        >
          <div
            className="w-full sm:max-w-sm rounded-t-3xl sm:rounded-2xl bg-surface p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl animate-sheet-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line-strong sm:hidden" />
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-ink">
                {isIOS ? 'Install on iPhone & iPad' : 'Install bitscanner App'}
              </h3>
              <button
                type="button"
                onClick={() => setShowGuideModal(false)}
                aria-label="Close install guide"
                className="flex h-9 w-9 items-center justify-center rounded-xl text-ink-faint hover:bg-surface-subtle cursor-pointer"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            {isIOS ? (
              <ol className="mt-3 flex flex-col gap-2 text-xs leading-relaxed text-ink-muted">
                <li className="flex items-start gap-2">
                  <span className="font-mono-tabular font-bold text-accent-strong">1.</span>
                  <span>
                    Tap the <strong className="inline-flex items-center gap-0.5 text-ink"><Share className="h-3 w-3" /> Share</strong> button in Safari&apos;s toolbar.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-mono-tabular font-bold text-accent-strong">2.</span>
                  <span>
                    Scroll down and select <strong className="text-ink">Add to Home Screen</strong>.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-mono-tabular font-bold text-accent-strong">3.</span>
                  <span>Launch bitscan offline anytime directly from your home screen.</span>
                </li>
              </ol>
            ) : (
              <p className="mt-3 text-xs leading-relaxed text-ink-muted">
                Open your browser&apos;s address bar install icon or browser menu (&vellip;) and select{' '}
                <strong className="text-ink">Install bitscanner</strong> or{' '}
                <strong className="text-ink">Add to Home Screen</strong> to use it as a standalone offline app.
              </p>
            )}
            <button
              type="button"
              onClick={() => setShowGuideModal(false)}
              className="mt-4 min-h-[44px] w-full rounded-xl bg-slate-900 text-xs font-bold text-white hover:bg-slate-800 cursor-pointer"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div
      role="status"
      data-testid="pwa-offline-banner"
      className="fixed bottom-20 left-4 z-50 flex items-center gap-2 rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white shadow-lg"
    >
      <WifiOff className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
      <span>Offline Mode · Scans &amp; OCR work locally</span>
    </div>
  );
};

