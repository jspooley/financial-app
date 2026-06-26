"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { InputField } from "@/components/ui/FormFields";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setLoading(false);

    if (authError) {
      setError(authError.message);
      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-brand-stone-50 px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="mb-6 flex items-center gap-3">
          <img
            src="/maison-joy-logo-tagline.png"
            alt="Maison Joy"
            className="h-16 w-auto"
          />
          <div>
            <p className="text-sm font-semibold text-brand-600">Maison Joy Financial Manager</p>
            <h1 className="mt-1 text-2xl font-semibold text-slate-900">Sign in</h1>
          </div>
        </div>
        <p className="text-sm text-slate-600">
          Log in to manage clients, invoices, and ledger entries with your partner.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <InputField
            label="Email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <InputField
            label="Password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          {error && <p className="text-sm text-red-600">{error}</p>}

          <Button type="submit" loading={loading} className="w-full">
            Sign in
          </Button>
        </form>
      </div>
    </div>
  );
}
