"use client";

import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";
import { useEffect, useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { RecipeManager } from "@/components/admin/RecipeManager";
import { getFirebaseServices, isFirebaseConfigured } from "@/lib/firebase";
import {
  observarFichasTecnicas,
  observarProdutos,
  removerFichaTecnica,
  salvarFichaTecnica,
  type FichaTecnicaInput,
} from "@/lib/firestore/fichas-tecnicas";
import { observarInsumos } from "@/lib/firestore/insumos";
import type { FichaTecnica, Insumo, Produto } from "@/types";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Ocorreu um erro inesperado.";
}

export default function FichasTecnicasPage() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(isFirebaseConfigured);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [products, setProducts] = useState<Produto[] | null>(null);
  const [insumos, setInsumos] = useState<Insumo[] | null>(null);
  const [fichas, setFichas] = useState<FichaTecnica[] | null>(null);
  const [dataError, setDataError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isFirebaseConfigured) return;

    try {
      const { auth } = getFirebaseServices();
      return onAuthStateChanged(
        auth,
        (currentUser) => {
          setUser(currentUser);
          if (currentUser) setDataError("");
          setAuthLoading(false);
        },
        (error) => {
          setAuthError(getErrorMessage(error));
          setAuthLoading(false);
        },
      );
    } catch (error) {
      // Service initialization fails synchronously; expose it on this route.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAuthError(getErrorMessage(error));
      setAuthLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user || !isFirebaseConfigured) return;

    try {
      const stopInsumos = observarInsumos(
        setInsumos,
        (error) => setDataError(getErrorMessage(error)),
      );
      const stopProdutos = observarProdutos(
        setProducts,
        (error) => setDataError(getErrorMessage(error)),
      );
      const stopFichas = observarFichasTecnicas(
        setFichas,
        (error) => setDataError(getErrorMessage(error)),
      );
      return () => {
        stopInsumos();
        stopProdutos();
        stopFichas();
      };
    } catch (error) {
      // Service initialization fails synchronously; report it in the page.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDataError(getErrorMessage(error));
    }
  }, [user]);

  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthError("");
    setBusy(true);
    try {
      const { auth } = getFirebaseServices();
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (error) {
      setAuthError(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut() {
    try {
      const { auth } = getFirebaseServices();
      await signOut(auth);
      setProducts(null);
      setInsumos(null);
      setFichas(null);
    } catch (error) {
      setDataError(getErrorMessage(error));
    }
  }

  async function handleSave(input: FichaTecnicaInput) {
    setBusy(true);
    try {
      await salvarFichaTecnica(input);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(produtoId: string) {
    setBusy(true);
    try {
      await removerFichaTecnica(produtoId);
    } finally {
      setBusy(false);
    }
  }

  if (!isFirebaseConfigured) {
    return (
      <AdminShell>
        <div className="page-heading">
          <div>
            <div className="eyebrow">Fase 2 · Engenharia de cardápio</div>
            <h1 className="page-title">Fichas técnicas</h1>
            <p className="page-subtitle">
              Conecte o Firebase para usar as fichas técnicas.
            </p>
          </div>
        </div>
        <div className="notice">
          Configure as variáveis de ambiente do Firebase conforme o arquivo{" "}
          <code>.env.example</code> e reinicie o servidor.
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
          Entre com o usuário administrador do Firebase para editar fichas técnicas.
        </p>
        {authError ? <div className="notice error">{authError}</div> : null}
        <form className="form-grid" onSubmit={handleLogin}>
          <div className="field full">
            <label htmlFor="fichas-login-email">E-mail</label>
            <input
              autoComplete="email"
              id="fichas-login-email"
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </div>
          <div className="field full">
            <label htmlFor="fichas-login-password">Senha</label>
            <input
              autoComplete="current-password"
              id="fichas-login-password"
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

  const dataLoading =
    (products === null || insumos === null || fichas === null) && !dataError;

  return (
    <AdminShell onSignOut={handleSignOut} userEmail={user.email ?? "Administrador"}>
      <div className="page-heading">
        <div>
          <div className="eyebrow">Fase 2 · Engenharia de cardápio</div>
          <h1 className="page-title">Fichas técnicas</h1>
          <p className="page-subtitle">
            Vincule os insumos às receitas e acompanhe o custo, o CMV e a margem
            bruta de cada produto.
          </p>
        </div>
      </div>

      {dataError ? <div className="notice error">{dataError}</div> : null}
      {dataLoading ? (
        <div className="panel loading-state">Carregando produtos e insumos…</div>
      ) : (
        <RecipeManager
          busy={busy}
          fichas={fichas ?? []}
          insumos={insumos ?? []}
          onDelete={handleDelete}
          onSave={handleSave}
          products={products ?? []}
        />
      )}
    </AdminShell>
  );
}
