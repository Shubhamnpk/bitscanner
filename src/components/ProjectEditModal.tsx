import React, { useEffect, useState } from 'react';
import { ArrowUpDown, Folder, Star, Trash2, X } from 'lucide-react';
import type { FolderId, ScanDocument } from '../types/scanner';
import { useHaptics } from '../hooks/useHaptics';

export const PROJECT_FOLDER_OPTIONS: Array<{
  id: Exclude<FolderId, 'all' | 'starred'>;
  label: string;
}> = [
  { id: 'documents', label: 'Documents' },
  { id: 'id_cards', label: 'ID Cards' },
  { id: 'receipts', label: 'Receipts' },
  { id: 'notes', label: 'Notes' },
  { id: 'signatures', label: 'Signatures' },
];

interface ProjectEditModalProps {
  document: ScanDocument | null;
  onClose: () => void;
  onSaveChanges: (nextDoc: ScanDocument) => void;
  onDeleteProject: (docId: string) => void;
}

export const ProjectEditModal: React.FC<ProjectEditModalProps> = ({
  document,
  onClose,
  onSaveChanges,
  onDeleteProject,
}) => {
  const haptics = useHaptics();
  const [title, setTitle] = useState(document?.title || '');
  const [folder, setFolder] = useState<ScanDocument['folder']>(document?.folder || 'documents');
  const [starred, setStarred] = useState<boolean>(document?.starred || false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!document) return;
    setTitle(document.title);
    setFolder(document.folder);
    setStarred(document.starred);
    setConfirmDelete(false);
  }, [document]);

  if (!document) return null;

  const handleSave = () => {
    haptics.success();
    onSaveChanges({
      ...document,
      title: title.trim() || document.title,
      folder,
      starred,
      updatedAt: Date.now(),
    });
    onClose();
  };

  const handleReversePages = () => {
    if (document.pages.length <= 1) return;
    haptics.tap();
    onSaveChanges({
      ...document,
      pages: [...document.pages].reverse(),
      updatedAt: Date.now(),
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Edit project details"
      data-testid="project-edit-modal"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/50 p-0 sm:p-4 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl animate-sheet-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-300 sm:hidden" />

        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div>
            <h2 className="text-base font-bold text-slate-900">Edit Document Project</h2>
            <p className="text-xs text-slate-500">
              Rename, organize folder, star, or adjust project pages
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close project settings"
            className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-4 flex flex-col gap-4">
          <div>
            <label
              htmlFor="project-edit-title"
              className="mb-1.5 block text-xs font-semibold text-slate-700"
            >
              Project Name
            </label>
            <input
              id="project-edit-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              data-testid="project-edit-title-input"
              className="min-h-[44px] w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-900 focus:border-teal-600 focus:bg-white focus:outline-none"
            />
          </div>

          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-700">
              <Folder className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
              <span>Folder Category</span>
            </div>
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
              {PROJECT_FOLDER_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    haptics.tap();
                    setFolder(opt.id);
                  }}
                  className={`min-h-[40px] rounded-xl border px-2 text-xs font-semibold transition-colors cursor-pointer ${
                    folder === opt.id
                      ? 'border-teal-600 bg-teal-50 text-teal-900'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                haptics.tap();
                setStarred((s) => !s);
              }}
              className={`flex min-h-[44px] items-center justify-center gap-2 rounded-xl border px-3 text-xs font-semibold transition-colors cursor-pointer ${
                starred
                  ? 'border-amber-300 bg-amber-50 text-amber-900'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              <Star
                className={`h-4 w-4 ${starred ? 'fill-amber-400 text-amber-500' : 'text-slate-400'}`}
                aria-hidden="true"
              />
              <span>{starred ? 'Favorited' : 'Mark Favorite'}</span>
            </button>

            <button
              type="button"
              disabled={document.pages.length <= 1}
              onClick={handleReversePages}
              className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
            >
              <ArrowUpDown className="h-4 w-4 text-slate-500" aria-hidden="true" />
              <span>Reverse Order</span>
            </button>
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
            {!confirmDelete ? (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-3 text-xs font-semibold text-red-600 hover:bg-red-50 cursor-pointer"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                <span>Delete Project</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  haptics.warning();
                  onDeleteProject(document.id);
                  onClose();
                }}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-red-600 px-3.5 text-xs font-bold text-white hover:bg-red-700 cursor-pointer"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                <span>Confirm Delete</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleSave}
              data-testid="project-edit-save-btn"
              className="inline-flex min-h-[44px] flex-1 max-w-[180px] items-center justify-center rounded-xl bg-teal-600 px-5 text-xs font-bold text-white hover:bg-teal-700 active:scale-[0.98] transition-all cursor-pointer"
            >
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
