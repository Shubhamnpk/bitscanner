import React from 'react';
import { FlaskConical, X } from 'lucide-react';

interface DemoModeBannerProps {
  loading?: boolean;
  onExit: () => void;
}

/**
 * Floating reminder that the workspace on screen is ephemeral. Demo mode is
 * entered with Ctrl/Cmd + Shift + D and never writes to IndexedDB.
 */
export const DemoModeBanner: React.FC<DemoModeBannerProps> = ({ loading = false, onExit }) => (
  <div
    role="status"
    data-testid="demo-mode-banner"
    className="animate-sheet-up fixed bottom-24 left-1/2 z-[80] flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 items-center gap-3 rounded-2xl border border-warning-line bg-warning-soft/95 px-3.5 py-2.5 shadow-xl shadow-amber-900/10 backdrop-blur sm:bottom-6"
  >
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-warning-soft text-warning">
      <FlaskConical className="h-4 w-4" aria-hidden="true" />
    </span>
    <div className="min-w-0 flex-1">
      <div className="text-xs font-bold text-warning-text">
        {loading ? 'Loading demo workspace…' : 'Demo mode'}
      </div>
      <p className="truncate text-[11px] text-warning-text/80">
        Sample files only · scans and edits are discarded
      </p>
    </div>
    <button
      type="button"
      onClick={onExit}
      data-testid="demo-mode-exit-btn"
      className="inline-flex min-h-[34px] shrink-0 items-center gap-1 rounded-lg border border-warning-line bg-surface px-2.5 text-[11px] font-bold text-warning-text transition-colors hover:bg-warning-soft cursor-pointer"
    >
      <X className="h-3.5 w-3.5" aria-hidden="true" />
      Exit
    </button>
  </div>
);
