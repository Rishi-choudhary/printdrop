'use client';

/**
 * FileUpload — drag-and-drop / click-to-browse component.
 *
 * Uploads to POST /api/files/upload (multipart), which stores the file on
 * Cloudflare R2 (or local in dev) and returns structured metadata.
 *
 * Usage:
 *   <FileUpload onUploaded={(meta) => setState(meta)} />
 *
 * `meta` shape: { fileUrl, fileName, fileSize, fileType, pageCount, key, driver }
 */

import { useState, useRef, useCallback, DragEvent, ChangeEvent } from 'react';
import { Upload, FileText, X, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import Cookies from 'js-cookie';

const API_BASE = '/api';

const ACCEPTED = ['application/pdf', 'image/jpeg', 'image/png',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
];
const ACCEPT_ATTR = '.pdf,.jpg,.jpeg,.png,.doc,.docx,.ppt,.pptx';
const MAX_MB = 50;

export interface UploadedFileMeta {
  key:       string;
  fileKey:   string;  // alias for key — storage object key for URL refresh
  fileUrl:   string;
  fileName:  string;
  fileSize:  number;
  fileType:  string;
  mimeType:  string;
  pageCount: number;
  driver:    string;
}

interface Props {
  onUploaded:  (meta: UploadedFileMeta) => void;
  onClear?:    () => void;
  disabled?:   boolean;
  className?:  string;
}

type UploadState = 'idle' | 'uploading' | 'done' | 'error';

export function FileUpload({ onUploaded, onClear, disabled, className = '' }: Props) {
  const [state,    setState]    = useState<UploadState>('idle');
  const [progress, setProgress] = useState(0);
  const [result,   setResult]   = useState<UploadedFileMeta | null>(null);
  const [error,    setError]    = useState('');
  const [dragging, setDragging] = useState(false);
  const inputRef                = useRef<HTMLInputElement>(null);

  const reset = () => {
    setState('idle');
    setProgress(0);
    setResult(null);
    setError('');
    if (inputRef.current) inputRef.current.value = '';
    onClear?.();
  };

  const upload = useCallback(async (file: File) => {
    // Client-side size guard
    if (file.size > MAX_MB * 1024 * 1024) {
      setError(`File is too large. Maximum is ${MAX_MB} MB.`);
      setState('error');
      return;
    }

    setState('uploading');
    setProgress(0);
    setError('');

    const formData = new FormData();
    formData.append('file', file);

    const token = Cookies.get('token');

    // Use XMLHttpRequest so we get upload progress events
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          setProgress(Math.round((e.loaded / e.total) * 100));
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data: UploadedFileMeta = JSON.parse(xhr.responseText);
            setResult(data);
            setState('done');
            setProgress(100);
            onUploaded(data);
            resolve();
          } catch {
            reject(new Error('Invalid response from server'));
          }
        } else {
          try {
            const body = JSON.parse(xhr.responseText);
            reject(new Error(body.error || `Upload failed (${xhr.status})`));
          } catch {
            reject(new Error(`Upload failed (${xhr.status})`));
          }
        }
      });

      xhr.addEventListener('error',   () => reject(new Error('Network error. Check your connection.')));
      xhr.addEventListener('timeout', () => reject(new Error('Upload timed out. Try a smaller file.')));

      xhr.open('POST', `${API_BASE}/files/upload`);
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.timeout = 120_000; // 2 min
      xhr.send(formData);
    }).catch((err: Error) => {
      setError(err.message);
      setState('error');
    });
  }, [onUploaded]);

  const handleFile = (file: File | undefined | null) => {
    if (!file || disabled) return;
    upload(file);
  };

  const onInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    handleFile(e.target.files?.[0]);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    handleFile(e.dataTransfer.files?.[0]);
  };

  const onDragOver  = (e: DragEvent) => { e.preventDefault(); setDragging(true); };
  const onDragLeave = ()               => setDragging(false);

  // ── Render: done state ──
  if (state === 'done' && result) {
    return (
      <div className={`rounded-xl border-2 border-green-300 bg-green-50 p-4 ${className}`}>
        <div className="flex items-start gap-3">
          <CheckCircle className="w-5 h-5 text-green-600 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-green-800 text-sm truncate">{result.fileName}</p>
            <p className="text-xs text-green-600 mt-0.5">
              {formatBytes(result.fileSize)} · {result.pageCount} page{result.pageCount !== 1 ? 's' : ''} · {result.fileType.toUpperCase()}
              {result.driver === 'r2' && <span className="ml-1.5 text-green-500">· Stored on R2</span>}
            </p>
          </div>
          <button
            onClick={reset}
            className="text-green-400 hover:text-green-700 transition-colors ml-2"
            title="Remove file"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  // ── Render: error state ──
  if (state === 'error') {
    return (
      <div className={`rounded-xl border-2 border-red-200 bg-red-50 p-4 ${className}`}>
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="font-semibold text-red-700 text-sm">Upload failed</p>
            <p className="text-xs text-red-500 mt-0.5">{error}</p>
          </div>
          <button onClick={reset} className="text-red-400 hover:text-red-600 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <button
          onClick={reset}
          className="mt-3 text-xs font-medium text-red-600 hover:underline"
        >
          Try again
        </button>
      </div>
    );
  }

  // ── Render: uploading state ──
  if (state === 'uploading') {
    return (
      <div className={`rounded-xl border-2 border-blue-200 bg-blue-50 p-6 ${className}`}>
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
          <p className="text-sm font-semibold text-blue-700">Uploading to Cloudflare R2…</p>
          <div className="w-full bg-blue-100 rounded-full h-2">
            <div
              className="bg-blue-500 h-2 rounded-full transition-all duration-200"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-xs text-blue-500">{progress}%</p>
        </div>
      </div>
    );
  }

  // ── Render: idle drop zone ──
  return (
    <div
      onClick={() => !disabled && inputRef.current?.click()}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      className={`
        rounded-xl border-2 border-dashed p-8 flex flex-col items-center gap-3 text-center
        cursor-pointer select-none transition-all duration-150
        ${dragging
          ? 'border-blue-400 bg-blue-50 scale-[1.01]'
          : 'border-gray-200 bg-gray-50 hover:border-blue-300 hover:bg-blue-50/50'
        }
        ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
        ${className}
      `}
    >
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center transition-colors ${dragging ? 'bg-blue-100' : 'bg-gray-100'}`}>
        {dragging
          ? <FileText className="w-6 h-6 text-blue-500" />
          : <Upload className="w-6 h-6 text-gray-400" />
        }
      </div>

      <div>
        <p className="font-semibold text-gray-700 text-sm">
          {dragging ? 'Drop your file here' : 'Drop a file or click to browse'}
        </p>
        <p className="text-xs text-gray-400 mt-1">
          PDF, JPG, PNG, DOCX, PPTX — up to {MAX_MB} MB
        </p>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_ATTR}
        className="hidden"
        onChange={onInputChange}
        disabled={disabled}
      />
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024)        return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
