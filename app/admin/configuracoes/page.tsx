"use client";

import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";
import { useEffect, useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { useAdminProfile } from "@/hooks/useAdminProfile";
import { getFirebaseServices, isFirebaseConfigured } from "@/lib/firebase";

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : "Ocorreu um erro inesperado.";
}

export default function ConfiguracoesPage() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(isFirebaseConfigured);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { profile, loading: profileLoading, error: profileError } =
    useAdminProfile(user);

  useEffect(() => {
    if (!isFirebaseConfigured) return;
    try {
      return onAuthStateChanged(
        getFirebaseServices().auth,
        (currentUser) => {
          setUser(currentUser);
          setAuthLoading(false);
        },
        (authError) => {
          setError(messageFrom(authError));
          setAuthLoading(false);
        },
      );
    } catch (authError) {
      // Service initialization fails synchronously; expose it on this route.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError(messageFrom(authError));
      setAuthLoading(false);
    }
  }, []);

  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await signInWithEmailAndPassword(
        getFirebaseServices().auth,
        email.trim(),
        password,
      );
    } catch (loginError) {
      setError(messageFrom(loginError));
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut() {
    try {
      await signOut(getFirebaseServices().auth);
    } catch (signOutError) {
      setError(messageFrom(signOutError));
    }
  }

  if (!isFirebaseConfigured) {
    return (
      <AdminShell>
        <div className="notice">
          Configure o Firebase Authentication e o Cloud Firestore antes de usar
          as configurações administrativas.
        </div>
      </AdminShell>
    );
  }
  if (authLoading) return <div className="loading-state">Verificando sessão…</div>;
  if (!user) {
    return (
      <main className="auth-card panel">
        <div className="eyebrow">Oliver Gutemberg · CMV</div>
        <h1>Acesse sua operação</h1>
        {error ? <div className="notice error">{error}</div> : null}
        <form className="form-grid" onSubmit={handleLogin}>
          <div className="field full">
            <label htmlFor="settings-email">E-mail</label>
            <input
              autoComplete="email"
              id="settings-email"
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </div>
          <div className="field full">
            <label htmlFor="settings-password">Senha</label>
            <input
              autoComplete="current-password"
              id="settings-password"
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </div>
          <div className="form-actions field full">
            <button className="button button-primary" disabled={busy} type="submit">
              {busy ? "Entrando…" : "Entrar"}
            </button>
          </div>
        </form>
      </main>
    );
  }
  if (profileLoading) {
    return <div className="loading-state">Carregando seu perfil de acesso…</div>;
  }
  if (!profile) {
    return (
      <AdminShell
        onSignOut={handleSignOut}
        profile={null}
        userEmail={user.email ?? "Administrador"}
      >
        <div className="notice error">{profileError}</div>
      </AdminShell>
    );
  }

  return (
    <AdminShell
      onSignOut={handleSignOut}
      profile={profile}
      userEmail={user.email ?? "Administrador"}
    >
      <div className="page-heading">
        <div>
          <div className="eyebrow">Configurações</div>
          <h1 className="page-title">Sua operação</h1>
          <p className="page-subtitle">
            Conexões e serviços que sustentam o sistema Oliver Gutemberg.
          </p>
        </div>
      </div>
      <section className="panel">
        <div className="panel-header">
          <h2 className="panel-title">Serviços integrados</h2>
        </div>
        <div className="panel-body">
          <p className="page-subtitle">
            Firebase Authentication protege o painel administrativo. Firestore
            mantém insumos, compras e dados do cardápio sincronizados. As imagens
            de OCR são processadas temporariamente e não são salvas no Firebase
            Storage.
          </p>
        </div>
      </section>
    </AdminShell>
  );
}
