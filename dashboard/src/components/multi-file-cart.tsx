'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, FileText, Copy, Palette,
         Layers, Maximize, Scissors, BookOpen } from 'lucide-react';
import { UploadedFileMeta } from './file-upload';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FilePref {
  color:       boolean;
  copies:      number;
  doubleSided: boolean;
  paperSize:   string;
  pageRange:   string;
  binding:     string;
}

export interface CartFile {
  id:   string;        // stable local key (use crypto.randomUUID())
  meta: UploadedFileMeta;
  pref: FilePref;
}

export const DEFAULT_PREF: FilePref = {
  color:       false,
  copies:      1,
  doubleSided: false,
  paperSize:   'A4',
  pageRange:   'all',
  binding:     'none',
};

// ── CartFileList ───────────────────────────────────────────────────────────────

interface CartFileListProps {
  files:    CartFile[];
  onChange: (id: string, pref: FilePref) => void;
}

export function CartFileList({ files, onChange }: CartFileListProps) {
  const [openId, setOpenId] = useState<string | null>(files[0]?.id ?? null);

  const toggle = (id: string) => setOpenId((prev) => (prev === id ? null : id));

  const copyToAll = (sourcePref: FilePref) => {
    files.forEach((f) => onChange(f.id, { ...sourcePref }));
  };

  return (
    <div className="space-y-2">
      {files.map((file) => (
        <FileAccordion
          key={file.id}
          file={file}
          isOpen={openId === file.id}
          onToggle={() => toggle(file.id)}
          onChange={(pref) => onChange(file.id, pref)}
          onCopyToAll={() => copyToAll(file.pref)}
          showCopyAll={files.length > 1}
        />
      ))}
    </div>
  );
}

// ── FileAccordion ──────────────────────────────────────────────────────────────

interface FileAccordionProps {
  file:        CartFile;
  isOpen:      boolean;
  onToggle:    () => void;
  onChange:    (pref: FilePref) => void;
  onCopyToAll: () => void;
  showCopyAll: boolean;
}

function FileAccordion({ file, isOpen, onToggle, onChange, onCopyToAll, showCopyAll }: FileAccordionProps) {
  const { meta, pref } = file;
  const summary = prefSummary(pref);

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Header row */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
      >
        <FileText className="w-4 h-4 text-gray-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-800 truncate">{meta.fileName}</p>
          <p className="text-[11px] text-gray-400 mt-0.5">
            {meta.pageCount} page{meta.pageCount !== 1 ? 's' : ''} · {summary}
          </p>
        </div>
        {isOpen
          ? <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
          : <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
        }
      </button>

      {/* Expanded settings */}
      {isOpen && (
        <div className="border-t border-gray-100 px-4 py-4 space-y-4">

          {/* Copy to all */}
          {showCopyAll && (
            <button
              type="button"
              onClick={onCopyToAll}
              className="flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700"
            >
              <Copy className="w-3.5 h-3.5" />
              Copy these settings to all files
            </button>
          )}

          {/* Color */}
          <ToggleRow
            icon={<Palette className="w-4 h-4" />}
            label="Print type"
            options={[
              { value: false, label: 'B&W',   desc: 'Grayscale' },
              { value: true,  label: 'Color', desc: 'Full color' },
            ]}
            selected={pref.color}
            onChange={(v) => onChange({ ...pref, color: v as boolean })}
          />

          {/* Copies */}
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <Copy className="w-4 h-4 text-gray-400" />
              Copies
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onChange({ ...pref, copies: Math.max(1, pref.copies - 1) })}
                className="w-8 h-8 rounded-lg border border-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-50 text-lg font-bold"
              >−</button>
              <span className="w-8 text-center font-bold text-base">{pref.copies}</span>
              <button
                type="button"
                onClick={() => onChange({ ...pref, copies: Math.min(99, pref.copies + 1) })}
                className="w-8 h-8 rounded-lg border border-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-50 text-lg font-bold"
              >+</button>
            </div>
          </div>

          {/* Sides */}
          <ToggleRow
            icon={<Layers className="w-4 h-4" />}
            label="Sides"
            options={[
              { value: false, label: 'Single', desc: 'One-sided' },
              { value: true,  label: 'Double', desc: 'Both sides' },
            ]}
            selected={pref.doubleSided}
            onChange={(v) => onChange({ ...pref, doubleSided: v as boolean })}
          />

          {/* Paper size */}
          <ToggleRow
            icon={<Maximize className="w-4 h-4" />}
            label="Paper size"
            options={[
              { value: 'A4',     label: 'A4',     desc: 'Standard' },
              { value: 'A3',     label: 'A3',     desc: 'Large' },
              { value: 'Letter', label: 'Letter', desc: 'US Letter' },
              { value: 'Legal',  label: 'Legal',  desc: 'US Legal' },
            ]}
            selected={pref.paperSize}
            onChange={(v) => onChange({ ...pref, paperSize: v as string })}
          />

          {/* Page range */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Scissors className="w-4 h-4 text-gray-400" />
              <span className="text-sm font-medium text-gray-700">Pages</span>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onChange({ ...pref, pageRange: 'all' })}
                className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition-all ${
                  pref.pageRange === 'all'
                    ? 'bg-blue-50 border-blue-300 text-blue-700'
                    : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >All pages</button>
              <input
                type="text"
                placeholder="e.g. 1-3, 5"
                value={pref.pageRange === 'all' ? '' : pref.pageRange}
                onChange={(e) => onChange({ ...pref, pageRange: e.target.value || 'all' })}
                onFocus={() => { if (pref.pageRange === 'all') onChange({ ...pref, pageRange: '' }); }}
                className="flex-1 px-3 py-2 rounded-lg text-sm border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Binding */}
          <ToggleRow
            icon={<BookOpen className="w-4 h-4" />}
            label="Binding"
            options={[
              { value: 'none',   label: 'None',   desc: 'Loose' },
              { value: 'staple', label: 'Staple', desc: 'Corner' },
              { value: 'spiral', label: 'Spiral', desc: 'Bound' },
            ]}
            selected={pref.binding}
            onChange={(v) => onChange({ ...pref, binding: v as string })}
          />

        </div>
      )}
    </div>
  );
}

// ── ToggleRow ─────────────────────────────────────────────────────────────────

function ToggleRow<T extends string | boolean>({
  icon, label, options, selected, onChange,
}: {
  icon:     React.ReactNode;
  label:    string;
  options:  { value: T; label: string; desc: string }[];
  selected: T;
  onChange: (v: T) => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-gray-400">{icon}</span>
        <span className="text-sm font-medium text-gray-700">{label}</span>
      </div>
      <div className="flex gap-2">
        {options.map((opt) => (
          <button
            type="button"
            key={String(opt.value)}
            onClick={() => onChange(opt.value)}
            className={`flex-1 px-2 py-2 rounded-lg text-center border transition-all ${
              selected === opt.value
                ? 'bg-blue-50 border-blue-300 text-blue-700'
                : 'border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            <p className="text-sm font-medium">{opt.label}</p>
            <p className="text-[10px] text-gray-400">{opt.desc}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function prefSummary(p: FilePref): string {
  const parts = [
    p.color ? 'Color' : 'B&W',
    `${p.copies} cop${p.copies === 1 ? 'y' : 'ies'}`,
    p.paperSize,
    p.doubleSided ? '2-sided' : '1-sided',
  ];
  if (p.pageRange !== 'all') parts.push(`pg ${p.pageRange}`);
  if (p.binding !== 'none')  parts.push(p.binding);
  return parts.join(' · ');
}
