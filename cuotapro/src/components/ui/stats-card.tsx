import { cn } from '@/lib/utils/cn';
import { LucideIcon, TrendingDown, TrendingUp } from 'lucide-react';

interface StatsCardProps {
  title: string;
  value: string;
  description?: string;
  icon?: LucideIcon;
  trend?: {
    value: number;
    label: string;
  };
  className?: string;
}

export function StatsCard({
  title,
  value,
  description,
  icon: Icon,
  trend,
  className,
}: StatsCardProps) {
  return (
    <div
      className={cn(
        'rounded-xl border border-gray-200 bg-white p-6 shadow-sm',
        className
      )}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-gray-500">{title}</p>
          <p className="mt-2 text-3xl font-bold text-gray-900">{value}</p>
          {description && (
            <p className="mt-1 text-sm text-gray-500">{description}</p>
          )}
          {trend && (
            <div
              className={cn(
                'mt-2 flex items-center gap-1 text-sm font-medium',
                trend.value >= 0 ? 'text-green-600' : 'text-red-600'
              )}
            >
              {trend.value >= 0 ? (
                <TrendingUp className="h-4 w-4" />
              ) : (
                <TrendingDown className="h-4 w-4" />
              )}
              <span>
                {trend.value >= 0 ? '+' : ''}
                {trend.value}%
              </span>
              <span className="text-gray-500">{trend.label}</span>
            </div>
          )}
        </div>
        {Icon && (
          <div className="rounded-lg bg-blue-50 p-3">
            <Icon className="h-6 w-6 text-blue-600" />
          </div>
        )}
      </div>
    </div>
  );
}
