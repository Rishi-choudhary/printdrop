'use client';

import {
  BadgeCheck, CheckCircle2, Circle, PackageCheck, Printer,
  Sparkles,
} from 'lucide-react';
import { ORDER_PROGRESS_STEPS, getOrderProgressIndex } from '@/lib/web-orders';

const STEP_ICONS = [
  BadgeCheck,
  Printer,
  PackageCheck,
  CheckCircle2,
  Sparkles,
] as const;

export function OrderProgress({ status, className = '' }: { status?: string; className?: string }) {
  const current = getOrderProgressIndex(status);
  const width = `${(current / (ORDER_PROGRESS_STEPS.length - 1)) * 100}%`;

  return (
    <div className={className}>
      <div className="relative px-1">
        <div className="absolute left-4 right-4 top-5 hidden h-1.5 rounded-full bg-gray-200 sm:block" />
        <div className="absolute left-4 right-4 top-5 hidden h-1.5 sm:block">
          <div
            className="h-full rounded-full bg-blue-600 transition-all duration-700 ease-out"
            style={{ width }}
          />
        </div>

        <ol className="relative grid grid-cols-1 gap-3 sm:grid-cols-5">
          {ORDER_PROGRESS_STEPS.map((label, index) => {
            const done = index <= current;
            const Icon = STEP_ICONS[index] || Circle;
            return (
              <li
                key={label}
                className={[
                  'flex items-center gap-3 sm:flex-col sm:items-center sm:text-center',
                  'rounded-xl sm:rounded-none bg-white sm:bg-transparent p-2 sm:p-0',
                ].join(' ')}
              >
                <span
                  className={[
                    'relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 transition-all',
                    done
                      ? 'border-blue-600 bg-blue-600 text-white shadow-sm shadow-blue-200'
                      : 'border-gray-200 bg-white text-gray-300',
                  ].join(' ')}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span
                  className={[
                    'text-xs font-semibold leading-snug',
                    done ? 'text-gray-900' : 'text-gray-400',
                  ].join(' ')}
                >
                  {label}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
