import React from 'react';
import { Camera, FolderOpen, Grid2x2, User } from 'lucide-react';
import type { ActiveWorkspaceView } from '../types/scanner';
import { useHaptics } from '../hooks/useHaptics';

interface MobileBottomBarProps {
  activeView: ActiveWorkspaceView;
  onNavigate: (view: ActiveWorkspaceView) => void;
  onOpenNewScan: () => void;
}

export const MobileBottomBar: React.FC<MobileBottomBarProps> = ({
  activeView,
  onNavigate,
  onOpenNewScan,
}) => {
  const haptics = useHaptics();

  if (
    activeView === 'editor' ||
    activeView === 'project' ||
    activeView === 'settings' ||
    activeView === 'about' ||
    activeView === 'release_notes' ||
    activeView === 'privacy' ||
    activeView === 'help'
  ) {
    return null;
  }

  return (
    <nav
      aria-label="Mobile Bottom Navigation"
      data-testid="mobile-bottom-bar"
      className="fixed bottom-0 left-0 right-0 z-40 md:hidden border-t border-line bg-surface pb-safe"
    >
      <div className="grid grid-cols-4 items-center h-[60px] px-2">
        <button
          type="button"
          data-testid="mobile-nav-docs"
          onClick={() => {
            haptics.tap();
            onNavigate('library');
          }}
          className={`flex flex-col items-center justify-center min-h-[44px] active:scale-95 transition-transform cursor-pointer ${
            activeView === 'library' ? 'text-accent-strong dark:text-teal-300 font-bold' : 'text-ink-muted dark:text-ink-faint'
          }`}
        >
          <FolderOpen className="h-5 w-5" aria-hidden="true" />
          <span className="mt-0.5 text-[11px] font-semibold tracking-tight">Docs</span>
        </button>

        <button
          type="button"
          data-testid="mobile-nav-tools"
          onClick={() => {
            haptics.tap();
            onNavigate('tools');
          }}
          className={`flex flex-col items-center justify-center min-h-[44px] active:scale-95 transition-transform cursor-pointer ${
            activeView === 'tools' || activeView === 'id_studio'
              ? 'text-accent-strong dark:text-teal-300 font-bold'
              : 'text-ink-muted dark:text-ink-faint'
          }`}
        >
          <Grid2x2 className="h-5 w-5" aria-hidden="true" />
          <span className="mt-0.5 text-[11px] font-semibold tracking-tight">Tools</span>
        </button>

        {/* Tactile CamScanner-style camera shutter button */}
        <div className="flex items-center justify-center">
          <button
            type="button"
            data-testid="mobile-nav-scan"
            onClick={() => {
              haptics.shutter();
              onOpenNewScan();
            }}
            aria-label="Scan new document"
            className="flex h-12 w-12 -mt-3 items-center justify-center rounded-2xl bg-accent text-white shadow-lg shadow-teal-600/30 active:scale-95 transition-transform cursor-pointer"
          >
            <Camera className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <button
          type="button"
          data-testid="mobile-nav-profile"
          onClick={() => {
            haptics.tap();
            onNavigate('profile');
          }}
          className={`flex flex-col items-center justify-center min-h-[44px] active:scale-95 transition-transform cursor-pointer ${
            activeView === 'profile' ? 'text-accent-strong dark:text-teal-300 font-bold' : 'text-ink-muted dark:text-ink-faint'
          }`}
        >
          <User className="h-5 w-5" aria-hidden="true" />
          <span className="mt-0.5 text-[11px] font-semibold tracking-tight">Profile</span>
        </button>
      </div>
    </nav>
  );
};
