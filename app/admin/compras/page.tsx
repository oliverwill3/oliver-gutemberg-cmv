"use client";

import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";
import { useEffect, useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { PurchaseEntry } from "@/components/admin/PurchaseEntry";
import { canAccessAdminPath } from "@/lib/auth/permissions";
import { getFirebaseServices, isFirebaseConfigured } from "@/lib/firebase";
import { observarCompras } from "@/lib/firestore/compras";
import { observarInsumos } from "@/lib/firestore/insumos";
import { useAdminProfile } from "@/hooks/useAdminProfile";
import type { Compra, Insumo } from "@/types";

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : "Ocorreu um erro inesperado.";
}

export default function ComprasPage() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(isFirebaseConfigured);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [insumos, setInsumos] = useState<Insumo[] | null>(null);
  const [purchases, setPurchases] = useState<Compra[] | null>(null);
  const [dataError, setDataError] = useState("");
  const [busy, setBusy] = useState(false);
  const { profile, loading: profileLoading, error: profileError } =
    useAdminProfile(user);

  useEffect(() => {
    if (!isFirebaseConfigured) return;
    try {
      const { auth } = getFirebaseServices();
      return onAuthStateChanged(
        auth,
        (currentUser) => {
          setUser(currentUser);
          setInsumos(null);
          setPurchases(null);
          if (currentUser) setDataError("");
          setAuthLoading(false);
        },
        (error) => {
          setAuthError(messageFrom(error));
          setAuthLoading(false);
        },
      );
    } catch (error) {
      // Service initialization fails synchronously; expose it on this route.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAuthError(messageFrom(error));
      setAuthLoading(false);
    }
  }, []);

  useEffect(() => {
    if (
      !user ||
      !profile ||
      !canAccessAdminPath("/admin/compras", profile.role) ||
      !isFirebaseConfigured
    ) return;
    try {
      const stopInsumos = observarInsumos(
        profile.storeId,
        setInsumos,
        (error) => setDataError(messageFrom(error)),
        true,
      );
      const stopPurchases = observarCompras(
        profile.storeId,
        setPurchases,
        (error) => setDataError(messageFrom(error)),
      );
      return () => {
        stopInsumos();
        stopPurchases();
      };
    } catch (error) {
      // Service initialization fails synchronously; report it on this route.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDataError(messageFrom(error));
    }
  }, [user, profile]);

  async function login(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setAuthError("");
    try {
      const { auth } = getFirebaseServices();
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (error) {
      setAuthError(messageFrom(error));
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    try {
      await signOut(getFirebaseServices().auth);
      setInsumos(null);
      setPurchases(null);
    } catch (error) {
      setDataError(messageFrom(error));
    }
  }

  if (!isFirebaseConfigured) {
    return (
      <AdminShell>
        <div className="page-heading">
          <div>
            <div className="eyebrow">Estoque · Compras</div>
            <h1 className="page-title">Entrada de notas fiscais</h1>
            <p className="page-subtitle">
              Configure o Firebase e o Gemini para iniciar o fluxo de compras.
            </p>
          </div>
        </div>
        <div className="notice">
          Preencha as credenciais Firebase em <code>.env.local</code>. A chave
          privada do Gemini deve ser configurada somente no servidor como{" "}
          <code>GEMINI_API_KEY</code>, sem o prefixo NEXT_PUBLIC.
        </div>
      </AdminShell>
    );
  }

  if (authLoading) {
    return <div className="loading-state">Verificando sessão…</div>;
  }

  if (!user) {
    return (
      <main className="auth-card panel">
        <div className="eyebrow">Oliver Gutemberg · CMV</div>
        <h1>Acesse sua operação</h1>
        <p className="page-subtitle">
          Entre com o usuário administrador do Firebase para registrar compras.
        </p>
        {authError ? <div className="notice error">{authError}</div> : null}
        <form className="form-grid" onSubmit={login}>
          <div className="field full">
            <label htmlFor="purchase-login-email">E-mail</label>
            <input
              autoComplete="email"
              id="purchase-login-email"
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </div>
          <div className="field full">
            <label htmlFor="purchase-login-password">Senha</label>
            <input
              autoComplete="current-password"
              id="purchase-login-password"
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
        onSignOut={logout}
        profile={null}
        userEmail={user.email ?? "Administrador"}
      >
        <div className="notice error">{profileError}</div>
      </AdminShell>
    );
  }

  return (
    <AdminShell
      onSignOut={logout}
      profile={profile}
      userEmail={user.email ?? "Administrador"}
    >
      <div className="page-heading">
        <div>
          <div className="eyebrow">Estoque · Compras</div>
          <h1 className="page-title">Entrada de notas fiscais</h1>
          <p className="page-subtitle">
            Registre notas, revise os itens e separe produção das compras gerais.
          </p>
        </div>
      </div>
      {dataError ? <div className="notice error">{dataError}</div> : null}
      {insumos === null || purchases === null ? (
        <div className="panel loading-state">Carregando estoque e histórico…</div>
      ) : (
        <PurchaseEntry
          insumos={insumos}
          purchases={purchases}
          storeId={profile.storeId}
          usuarioId={user.uid}
        />
      )}
    </AdminShell>
  );
}
