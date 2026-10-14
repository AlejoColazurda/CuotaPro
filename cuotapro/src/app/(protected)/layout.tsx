'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Sidebar } from '@/components/layout/sidebar';
import { LoadingPage } from '@/components/ui/spinner';
import type { User } from '@supabase/supabase-js';

interface UserData {
  user: User;
  profile: { full_name: string | null } | null;
  tenant: { name: string } | null;
}

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [userData, setUserData] = useState<UserData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchUser = async () => {
      const supabase = createClient();

      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        router.push('/login');
        return;
      }

      const { data: profile } = await supabase
        .from('user_profiles')
        .select('full_name')
        .eq('id', user.id)
        .single() as { data: { full_name: string | null } | null };

      const { data: tenantUser } = await supabase
        .from('tenant_users')
        .select('tenant_id, tenants(name)')
        .eq('user_id', user.id)
        .maybeSingle() as { data: { tenant_id: string; tenants: { name: string } } | null };

      if (!tenantUser) {
        router.replace('/onboarding');
        return;
      }

      setUserData({
        user,
        profile,
        tenant: tenantUser?.tenants || null,
      });
      setIsLoading(false);
    };

    fetchUser();
  }, [router]);

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
  };

  if (isLoading) {
    return <LoadingPage message="Cargando..." />;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar
        tenantName={userData?.tenant?.name}
        userName={userData?.profile?.full_name || userData?.user?.email?.split('@')[0]}
        userEmail={userData?.user?.email}
        onLogout={handleLogout}
      />
      <main className="lg:pl-64">
        <div className="p-4 pt-16 lg:p-8 lg:pt-8">{children}</div>
      </main>
    </div>
  );
}
