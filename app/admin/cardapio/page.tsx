"use client";

import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";
import { useEffect, useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { MenuProductManager } from "@/components/admin/MenuProductManager";
import { getFirebaseServices, isFirebaseConfigured } from "@/lib/firebase";
import {
  observarProdutosCardapio,
  salvarOrdemProdutos,
} from "@/lib/firestore/cardapio";
import type { Produto } from "@/types";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Ocorreu um erro inesperado.";
}

function categoryName(product: Produto) {
  return product.categoriaNome?.trim() || "Sem categoria";
}

function sortProducts(products: Produto[]) {
  return [...products].sort((a, b) => {
    const categoryOrder = categoryName(a).localeCompare(categoryName(b), "pt-BR");
    if (categoryOrder !== 0) return categoryOrder;
    const aOrder =
      typeof a.ordem === "number" && Number.isFinite(a.ordem)
        ? a.ordem
        : Number.MAX_SAFE_INTEGER;
    const bOrder =
      typeof b.ordem === "number" && Number.isFinite(b.ordem)
        ? b.ordem
        : Number.MAX_SAFE_INTEGER;
    return aOrder - bOrder || a.nome.localeCompare(b.nome, "pt-BR");
  });
}

export default function AdminCardapioPage() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(isFirebaseConfigured);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [products, setProducts] = useState<Produto[] | null>(null);
  const [dataError, setDataError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isFirebaseConfigured) return;
    try {
      return onAuthStateChanged(
        getFirebaseServices().auth,
        (currentUser) => {
          setUser(currentUser);
          setProducts(null);
          setDataError("");
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
      return observarProdutosCardapio(
        setProducts,
        (error) => setDataError(getErrorMessage(error)),
      );
    } catch (error) {
      // Service initialization fails synchronously; report it on this route.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDataError(getErrorMessage(error));
    }
  }, [user]);

  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthError("");
    setBusy(true);
    try {
      await signInWithEmailAndPassword(
        getFirebaseServices().auth,
        email.trim(),
        password,
      );
    } catch (error) {
      setAuthError(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut() {
    try {
      await signOut(getFirebaseServices().auth);
      setProducts(null);
    } catch (error) {
      setDataError(getErrorMessage(error));
    }
  }

  async function handleMove(category: string, from: number, to: number) {
    if (!products || busy) return;
    const categoryProducts = sortProducts(products).filter(
      (product) => categoryName(product) === category,
    );
    if (
      from < 0 ||
      to < 0 ||
      from >= categoryProducts.length ||
      to >= categoryProducts.length
    ) {
      return;
    }
    const reordered = [...categoryProducts];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);

    setBusy(true);
    setNotice("");
    setDataError("");
    try {
      await salvarOrdemProdutos(reordered);
      setNotice(`Ordem da categoria “${category}” atualizada.`);
    } catch (error) {
      setDataError(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  if (!isFirebaseConfigured) {
    return (
      <AdminShell>
        <div className="page-heading">
          <div>
            <div className="eyebrow">Fase 3 · Experiência do cliente</div>
            <h1 className="page-title">Cardápio</h1>
            <p className="page-subtitle">
              Configure o Firebase para organizar os produtos do salão.
            </p>
          </div>
        </div>
        <div className="notice">
          Configure as variáveis de ambiente do Firebase conforme{" "}
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
          Entre com o usuário administrador para organizar o cardápio.
        </p>
        {authError ? <div className="notice error">{authError}</div> : null}
        <form className="form-grid" onSubmit={handleLogin}>
          <div className="field full">
            <label htmlFor="cardapio-login-email">E-mail</label>
            <input
              autoComplete="email"
              id="cardapio-login-email"
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </div>
          <div className="field full">
            <label htmlFor="cardapio-login-password">Senha</label>
            <input
              autoComplete="current-password"
              id="cardapio-login-password"
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

  return (
    <AdminShell
      onSignOut={handleSignOut}
      userEmail={user.email ?? "Administrador"}
    >
      <div className="page-heading">
        <div>
          <div className="eyebrow">Fase 3 · Experiência do cliente</div>
          <h1 className="page-title">Cardápio</h1>
          <p className="page-subtitle">
            Produtos agrupados por categoria. Use as setas para mudar a ordem
            exibida no cardápio digital.
          </p>
        </div>
      </div>
      {dataError ? <div className="notice error">{dataError}</div> : null}
      {notice ? <div className="notice success">{notice}</div> : null}
      {products === null ? (
        <div className="panel loading-state">Carregando produtos…</div>
      ) : (
        <MenuProductManager
          busy={busy}
          onMove={(category, from, to) => void handleMove(category, from, to)}
          products={sortProducts(products)}
        />
      )}
    </AdminShell>
  );
}
