import React, { useState } from 'react';
import { Check, Copy, Download, X } from 'lucide-react';
import { KOTLIN_BLUEPRINT_FILES } from '../data/kotlinBlueprint';

interface KotlinBlueprintModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const KotlinBlueprintModal: React.FC<KotlinBlueprintModalProps> = ({ isOpen, onClose }) => {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const activeFile = KOTLIN_BLUEPRINT_FILES[selectedIdx];

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(activeFile.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore clipboard restrictions
    }
  };

  const handleDownloadFile = () => {
    const blob = new Blob([activeFile.code], { type: 'text/x-kotlin;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = activeFile.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="kotlin-modal-title"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 p-0 sm:p-4 backdrop-blur-xs"
    >
      <div className="flex max-h-[92dvh] sm:max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-t-3xl sm:rounded-2xl border border-line bg-surface shadow-xl animate-sheet-up pb-safe">
        <div className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-line-strong sm:hidden" />
        <div className="flex items-center justify-between border-b border-line px-5 sm:px-6 py-3.5 sm:py-4">
          <div>
            <h2 id="kotlin-modal-title" className="text-base sm:text-lg font-bold text-ink">
              Android Kotlin Native Source Architecture
            </h2>
            <p className="text-xs text-ink-muted mt-0.5">
              Jetpack Compose + CameraX + OpenCV Perspective Dewarp + ML Kit Free OCR + Android PdfDocument
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Kotlin source viewer"
            className="flex h-11 w-11 sm:h-8 sm:w-8 items-center justify-center rounded-xl text-ink-faint hover:bg-surface-subtle hover:text-ink-soft cursor-pointer shrink-0"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="flex flex-1 flex-col overflow-hidden md:flex-row">
          {/* File list */}
          <aside className="w-full shrink-0 border-b border-line bg-surface-muted p-3 md:w-64 md:border-r md:border-b-0 overflow-y-auto">
            <div className="mb-2 px-2 text-xs font-semibold text-ink-muted">Kotlin Modules</div>
            <div className="flex flex-row gap-1 overflow-x-auto md:flex-col">
              {KOTLIN_BLUEPRINT_FILES.map((file, idx) => (
                <button
                  key={file.filename}
                  type="button"
                  onClick={() => {
                    setSelectedIdx(idx);
                    setCopied(false);
                  }}
                  className={`rounded-lg px-3 py-2 text-left text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    idx === selectedIdx
                      ? 'bg-accent text-white'
                      : 'text-ink-soft hover:bg-slate-200/70'
                  }`}
                >
                  {file.filename}
                </button>
              ))}
            </div>
          </aside>

          {/* Code view */}
          <div className="flex flex-1 flex-col overflow-hidden bg-slate-950 text-slate-100">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-slate-900 px-5 py-3">
              <div>
                <div className="font-mono-tabular text-xs text-teal-400">
                  {activeFile.packagePath}
                </div>
                <div className="mt-0.5 text-xs text-ink-faint">{activeFile.summary}</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopy}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 cursor-pointer"
                >
                  {copied ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-teal-400" aria-hidden="true" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Copy Kotlin</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleDownloadFile}
                  className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-strong cursor-pointer"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Download .kt</span>
                </button>
              </div>
            </div>

            <pre className="flex-1 overflow-auto p-5 text-xs leading-relaxed font-mono-tabular text-slate-200">
              <code>{activeFile.code}</code>
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};

