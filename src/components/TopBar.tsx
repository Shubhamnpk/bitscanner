import React from 'react';
import { ScanLine } from 'lucide-react';
import type { ActiveWorkspaceView } from '../types/scanner';

interface TopBarProps {
  activeView: ActiveWorkspaceView;
  hideAll?: boolean;
  onNavigate: (view: ActiveWorkspaceView) => void;
  onOpenNewScan: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  activeView,
  hideAll = false,
  onNavigate,
  onOpenNewScan,
}) => {
  if (hideAll) return null;

  const hideOnMobile = activeView === 'editor';

  return (
    <header
      className={`${
        hideOnMobile ? 'hidden md:block' : 'block'
      } sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-md`}
    >
      <div className="flex h-12 md:h-auto items-center justify-between gap-4 px-4 md:gap-8 md:px-6 md:py-3.5">
        {/* Zone 1: Brand mark + wordmark */}
        <button
          type="button"
          onClick={() => onNavigate('library')}
          className="flex items-center gap-2 text-left whitespace-nowrap shrink-0 min-h-[44px] md:min-h-0 focus-visible:outline-2 focus-visible:outline-teal-600 rounded-md cursor-pointer"
        >
          <img src="/icon.svg" alt="" aria-hidden="true" className="h-7 w-7 md:h-8 md:w-8 rounded-lg" />
          <span className="text-base md:text-lg font-bold tracking-tight text-slate-900 font-display">
             bitscan
          </span>
        </button>

        {/* Zone 2: 4 concise single-line nav links (desktop) */}
        <nav aria-label="Primary" className="hidden md:flex items-center gap-6">
          <button
            type="button"
            data-testid="top-nav-docs"
            onClick={() => onNavigate('library')}
            className={`text-sm font-medium transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 cursor-pointer ${
              activeView === 'library' || activeView === 'editor' || activeView === 'project'
                ? 'border-teal-600 text-teal-700 font-bold dark:border-teal-400 dark:text-teal-300'
                : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            Docs
          </button>
          <button
            type="button"
            data-testid="top-nav-tools"
            onClick={() => onNavigate('tools')}
            className={`text-sm font-medium transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 cursor-pointer ${
              activeView === 'tools'
                ? 'border-teal-600 text-teal-700 font-bold dark:border-teal-400 dark:text-teal-300'
                : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            Tools
          </button>
          <button
            type="button"
            data-testid="top-nav-id-card"
            onClick={() => onNavigate('id_studio')}
            className={`text-sm font-medium transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 cursor-pointer ${
              activeView === 'id_studio'
                ? 'border-teal-600 text-teal-700 font-bold dark:border-teal-400 dark:text-teal-300'
                : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            ID Card
          </button>
          <button
            type="button"
            data-testid="top-nav-profile"
            onClick={() => onNavigate('profile')}
            className={`text-sm font-medium transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 cursor-pointer ${
              activeView === 'profile' || activeView === 'settings'
                ? 'border-teal-600 text-teal-700 font-bold dark:border-teal-400 dark:text-teal-300'
                : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            Profile
          </button>
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            data-testid="top-nav-new-scan"
            onClick={onOpenNewScan}
            className="inline-flex items-center gap-1.5 rounded-xl md:rounded-lg bg-teal-600 px-3.5 py-1.5 md:px-4 md:py-2 text-xs md:text-sm font-semibold text-white hover:bg-teal-700 active:scale-[0.98] transition-all whitespace-nowrap shrink-0 cursor-pointer"
          >
            <ScanLine className="h-4 w-4" aria-hidden="true" />
            <span>New Scan</span>
          </button>
        </div>
      </div>
    </header>
  );
};
