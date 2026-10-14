'use client';

import { Suspense } from 'react';
import { AuthForm } from './auth-form';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';

function AuthSkeleton() {
  return (
    <Card className="w-full max-w-md">
      <CardContent className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </CardContent>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<AuthSkeleton />}>
      <AuthForm />
    </Suspense>
  );
}
