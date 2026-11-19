import { CreditCard, FileText, FolderOpen, PenTool, Receipt, Star, StickyNote } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { FolderId, ScanDocument } from '../types/scanner';

/** Sidebar folder rail. Order is the navigation order. */
export const FOLDERS: ReadonlyArray<{ id: FolderId; label: string; icon: LucideIcon }> = [
  { id: 'all', label: 'All Docs', icon: FolderOpen },
  { id: 'documents', label: 'Documents', icon: FileText },
  { id: 'id_cards', label: 'ID Cards', icon: CreditCard },
  { id: 'receipts', label: 'Receipts', icon: Receipt },
  { id: 'notes', label: 'Notes', icon: StickyNote },
  { id: 'signatures', label: 'Signatures', icon: PenTool },
  { id: 'starred', label: 'Starred', icon: Star },
];

/** Singular label for a document's folder. */
export const FOLDER_LABEL: Record<ScanDocument['folder'], string> = {
  documents: 'Document',
  id_cards: 'ID Card',
  receipts: 'Receipt',
  notes: 'Notes',
  signatures: 'Signature',
};
