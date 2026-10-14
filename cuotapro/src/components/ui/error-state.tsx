import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from './button';
import { cn } from '@/lib/utils/cn';

interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({
  title = 'Ocurrió un error',
  message = 'No pudimos cargar la información. Por favor, intentá de nuevo.',
  onRetry,
  className,
}: ErrorStateProps) {
  return (
    <div
      className={cn(
        'flex min-h-[300px] flex-col items-center justify-center rounded-xl border border-red-200 bg-red-50 p-8 text-center',
        className
      )}
    >
      <div className="mb-4 rounded-full bg-red-100 p-3">
        <AlertTriangle className="h-8 w-8 text-red-600" />
      </div>
      <h3 className="mb-2 text-lg font-semibold text-red-900">{title}</h3>
      <p className="mb-4 max-w-sm text-sm text-red-700">{message}</p>
      {onRetry && (
        <Button variant="outline" onClick={onRetry}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Reintentar
        </Button>
      )}
    </div>
  );
}
