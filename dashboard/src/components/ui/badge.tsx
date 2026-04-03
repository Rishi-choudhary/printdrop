const statusColors: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-700',
  payment_pending: 'bg-yellow-100 text-yellow-800',
  queued: 'bg-blue-100 text-blue-700',
  printing: 'bg-orange-100 text-orange-700',
  ready: 'bg-green-100 text-green-700',
  picked_up: 'bg-gray-100 text-gray-500',
  cancelled: 'bg-red-100 text-red-700',
  paid: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  active: 'bg-green-100 text-green-700',
  inactive: 'bg-gray-100 text-gray-500',
};

interface BadgeProps {
  status: string;
  className?: string;
}

export function Badge({ status, className = '' }: BadgeProps) {
  const color = statusColors[status] || 'bg-gray-100 text-gray-700';
  const label = status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${color} ${className}`}>
      {label}
    </span>
  );
}
