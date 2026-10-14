import { cn } from '@/lib/utils/cn';
import { Loader2 } from 'lucide-react';

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function Spinner({ size = 'md', className }: SpinnerProps) {
  const sizeClasses = {
    sm: 'h-4 w-4',
    md: 'h-6 w-6',
    lg: 'h-8 w-8',
  };

  return (
    <Loader2
      className={cn('animate-spin text-blue-600', sizeClasses[size], className)}
    />
  );
}

export function LoadingPage({ message = 'Cargando...' }: { message?: string }) {
  return (
    <div className="flex min-h-[400px] flex-col items-center justify-center gap-4">
      <Spinner size="lg" />
      <p className="text-sm text-gray-500">{message}</p>
    </div>
  );
}

export function LoadingOverlay({ message = 'Procesando...' }: { message?: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/80 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-4 rounded-xl bg-white p-8 shadow-lg">
        <Spinner size="lg" />
        <p className="text-sm text-gray-600">{message}</p>
      </div>
    </div>
  );
}
