"use client";

import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { getFirebaseServices, isFirebaseConfigured } from "@/lib/firebase";
import {
  atualizarInsumo,
  criarInsumo,
  observarInsumos,
  removerInsumo,
} from "@/lib/firestore/insumos";
import { calcularCustoUnitarioInsumo } from "@/lib/utils/cmv";
import type { Insumo, UnidadeMedida } from "@/types";

type FormValues = {
  nome: string;
  categoria: string;
  unidade: UnidadeMedida;
  quantidadeCompra: string;
  estoqueMinimo: string;
  precoCompra: string;
  fatorCorrecao: string;
  fornecedor: string;
};

const emptyForm: FormValues = {
  nome: "",
  categoria: "",
  unidade: "kg",
  quantidadeCompra: "",
  estoqueMinimo: "",
  precoCompra: "",
  fatorCorrecao: "1",
  fornecedor: "",
};

const units: UnidadeMedida[] = ["kg", "g", "L", "ml", "unidade", "pacote", "caixa"];
const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Ocorreu um erro inesperado. Tente novamente.";
}

export default function InsumosPage() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(isFirebaseConfigured);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [insumos, setInsumos] = useState<Insumo[]>([]);
  const [loading, setLoading] = useState(isFirebaseConfigured);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormValues>(emptyForm);

  useEffect(() => {
    if (!isFirebaseConfigured) {
      return;
    }

    try {
      const { auth } = getFirebaseServices();
      return onAuthStateChanged(
        auth,
        (currentUser) => {
          setUser(currentUser);
          setLoading(Boolean(currentUser));
          if (currentUser) setError("");
          if (!currentUser) setInsumos([]);
          setAuthLoading(false);
        },
        (authListenerError) => {
          setAuthError(getErrorMessage(authListenerError));
          setAuthLoading(false);
        },
      );
    } catch (firebaseError) {
      // Service initialization fails synchronously; expose it on the login screen.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAuthError(getErrorMessage(firebaseError));
      setAuthLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user || !isFirebaseConfigured) {
      return;
    }

    try {
      return observarInsumos(
        (items) => {
          setInsumos(items);
          setLoading(false);
        },
        (listenerError) => {
          setError(getErrorMessage(listenerError));
          setLoading(false);
        },
      );
    } catch (listenerError) {
      // Service initialization fails synchronously; report it in the page.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError(getErrorMessage(listenerError));
      setLoading(false);
    }
  }, [user]);

  const filteredInsumos = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    if (!term) return insumos;
    return insumos.filter((item) =>
      `${item.nome} ${item.categoria} ${item.fornecedor ?? ""}`
        .toLocaleLowerCase("pt-BR")
        .includes(term),
    );
  }, [insumos, search]);

  const resetForm = useCallback(() => {
    setForm(emptyForm);
    setEditingId(null);
  }, []);

  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setAuthError("");
    try {
      const { auth } = getFirebaseServices();
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (loginError) {
      setAuthError(getErrorMessage(loginError));
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut() {
    setError("");
    try {
      const { auth } = getFirebaseServices();
      await signOut(auth);
      resetForm();
    } catch (signOutError) {
      setError(getErrorMessage(signOutError));
    }
  }

  function startEditing(item: Insumo) {
    setEditingId(item.id);
    setNotice("");
    setError("");
    setForm({
      nome: item.nome,
      categoria: item.categoria,
      unidade: item.unidade,
      quantidadeCompra: String(item.quantidadeCompra),
      estoqueMinimo: String(item.estoqueMinimo ?? ""),
      precoCompra: String(item.precoCompra),
      fatorCorrecao: String(item.fatorCorrecao),
      fornecedor: item.fornecedor ?? "",
    });
    document.getElementById("insumo-form")?.scrollIntoView({ behavior: "smooth" });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    setError("");

    try {
      const quantidadeCompra = Number(form.quantidadeCompra);
      const estoqueMinimo = form.estoqueMinimo.trim()
        ? Number(form.estoqueMinimo)
        : 0;
      const precoCompra = Number(form.precoCompra);
      const fatorCorrecao = Number(form.fatorCorrecao);
      if (!Number.isFinite(estoqueMinimo) || estoqueMinimo < 0) {
        throw new Error("Informe um estoque mínimo válido ou deixe o campo vazio.");
      }
      const custoUnitario = calcularCustoUnitarioInsumo(
        precoCompra,
        quantidadeCompra,
        fatorCorrecao,
      );
      const insumo = {
        nome: form.nome.trim(),
        categoria: form.categoria.trim(),
        unidade: form.unidade,
        quantidadeCompra,
        estoqueMinimo,
        precoCompra,
        fatorCorrecao,
        custoUnitario,
        fornecedor: form.fornecedor.trim(),
        atualizadoEm: new Date().toISOString(),
      };

      if (!insumo.nome || !insumo.categoria) {
        throw new Error("Preencha o nome e a categoria do insumo.");
      }

      if (editingId) {
        await atualizarInsumo(editingId, insumo);
        setNotice("Insumo atualizado com sucesso.");
      } else {
        await criarInsumo(insumo);
        setNotice("Insumo cadastrado com sucesso.");
      }
      resetForm();
    } catch (saveError) {
      setError(getErrorMessage(saveError));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(item: Insumo) {
    if (!window.confirm(`Excluir o insumo "${item.nome}"?`)) return;
    setError("");
    setNotice("");
    try {
      await removerInsumo(item.id);
      if (editingId === item.id) resetForm();
      setNotice("Insumo removido.");
    } catch (deleteError) {
      setError(getErrorMessage(deleteError));
    }
  }

  if (!isFirebaseConfigured) {
    return (
      <AdminShell>
        <div className="page-heading">
          <div>
            <div className="eyebrow">Fase 1 · Configuração</div>
            <h1 className="page-title">Conecte seu Firebase</h1>
            <p className="page-subtitle">
              Configure as credenciais do projeto para começar a cadastrar insumos.
            </p>
          </div>
        </div>
        <section className="panel">
          <div className="panel-body">
            <div className="notice">
              Crie um projeto no Firebase, habilite Authentication com e-mail/senha,
              e Firestore. Copie <code>.env.example</code> para{" "}
              <code>.env.local</code>, preencha as credenciais e reinicie o servidor.
            </div>
            <p className="page-subtitle">
              Em Authentication, cadastre os usuários administradores no console do
              Firebase. O cadastro de usuários não fica público nesta primeira versão.
            </p>
          </div>
        </section>
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
        <p className="page-subtitle">Entre com o usuário administrador do Firebase.</p>
        {authError ? <div className="notice error">{authError}</div> : null}
        <form className="form-grid" onSubmit={handleLogin}>
          <div className="field full">
            <label htmlFor="login-email">E-mail</label>
            <input
              autoComplete="email"
              id="login-email"
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </div>
          <div className="field full">
            <label htmlFor="login-password">Senha</label>
            <input
              autoComplete="current-password"
              id="login-password"
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

  const totalInvestido = insumos.reduce(
    (total, item) => total + item.precoCompra,
    0,
  );

  return (
    <AdminShell onSignOut={handleSignOut} userEmail={user.email ?? "Administrador"}>
      <div className="page-heading">
        <div>
          <div className="eyebrow">Fase 1 · Gestão de estoque</div>
          <h1 className="page-title">Insumos</h1>
          <p className="page-subtitle">
            Cadastre matérias-primas e acompanhe o custo corrigido pelas perdas de preparo.
          </p>
        </div>
      </div>

      <div className="stat-grid">
        <section className="panel stat-card">
          <div className="stat-label">Insumos cadastrados</div>
          <div className="stat-value">{insumos.length}</div>
          <div className="stat-note">Matérias-primas na sua base</div>
        </section>
        <section className="panel stat-card">
          <div className="stat-label">Categorias</div>
          <div className="stat-value">
            {new Set(insumos.map((item) => item.categoria)).size}
          </div>
          <div className="stat-note">Grupos de insumos ativos</div>
        </section>
        <section className="panel stat-card">
          <div className="stat-label">Valor de compra cadastrado</div>
          <div className="stat-value">{currency.format(totalInvestido)}</div>
          <div className="stat-note">Soma dos preços de compra informados</div>
        </section>
      </div>

      {error ? <div className="notice error">{error}</div> : null}
      {notice ? <div className="notice success">{notice}</div> : null}

      <section className="panel" id="insumo-form">
        <div className="panel-header">
          <h2 className="panel-title">
            {editingId ? "Editar insumo" : "Cadastrar insumo"}
          </h2>
        </div>
        <div className="panel-body">
          <form onSubmit={handleSubmit}>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="nome">Nome do insumo</label>
                <input
                  id="nome"
                  onChange={(event) => setForm({ ...form, nome: event.target.value })}
                  placeholder="Ex.: Filé mignon"
                  required
                  value={form.nome}
                />
              </div>
              <div className="field">
                <label htmlFor="categoria">Categoria</label>
                <input
                  id="categoria"
                  onChange={(event) =>
                    setForm({ ...form, categoria: event.target.value })
                  }
                  placeholder="Ex.: Carnes"
                  required
                  value={form.categoria}
                />
              </div>
              <div className="field">
                <label htmlFor="preco">Preço da compra (R$)</label>
                <input
                  id="preco"
                  min="0"
                  onChange={(event) =>
                    setForm({ ...form, precoCompra: event.target.value })
                  }
                  required
                  step="0.01"
                  type="number"
                  value={form.precoCompra}
                />
              </div>
              <div className="field">
                <label htmlFor="quantidade">Quantidade comprada</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    id="quantidade"
                    min="0.0001"
                    onChange={(event) =>
                      setForm({ ...form, quantidadeCompra: event.target.value })
                    }
                    required
                    step="any"
                    type="number"
                    value={form.quantidadeCompra}
                  />
                  <select
                    aria-label="Unidade de medida"
                    onChange={(event) =>
                      setForm({
                        ...form,
                        unidade: event.target.value as UnidadeMedida,
                      })
                    }
                    value={form.unidade}
                  >
                    {units.map((unit) => (
                      <option key={unit} value={unit}>
                        {unit}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="field">
                <label htmlFor="estoque-minimo">Estoque mínimo para alerta</label>
                <input
                  id="estoque-minimo"
                  min="0"
                  onChange={(event) =>
                    setForm({ ...form, estoqueMinimo: event.target.value })
                  }
                  placeholder="Opcional"
                  step="any"
                  type="number"
                  value={form.estoqueMinimo}
                />
                <span className="field-hint">
                  Usado para gerar sugestões de reposição; não é previsão de
                  vendas nem pedido automático.
                </span>
              </div>
              <div className="field">
                <label htmlFor="fator">Fator de correção</label>
                <input
                  id="fator"
                  min="1"
                  onChange={(event) =>
                    setForm({ ...form, fatorCorrecao: event.target.value })
                  }
                  required
                  step="0.01"
                  type="number"
                  value={form.fatorCorrecao}
                />
                <span className="field-hint">
                  Use 1,00 sem perdas. Ex.: 1,25 representa custo 25% maior por
                  unidade aproveitável.
                </span>
              </div>
              <div className="field">
                <label htmlFor="fornecedor">Fornecedor (opcional)</label>
                <input
                  id="fornecedor"
                  onChange={(event) =>
                    setForm({ ...form, fornecedor: event.target.value })
                  }
                  placeholder="Nome do fornecedor"
                  value={form.fornecedor}
                />
              </div>
            </div>
            <div className="form-actions">
              {editingId ? (
                <button
                  className="button button-secondary"
                  onClick={resetForm}
                  type="button"
                >
                  Cancelar edição
                </button>
              ) : null}
              <button className="button button-primary" disabled={busy} type="submit">
                {busy ? "Salvando…" : editingId ? "Salvar alterações" : "Salvar insumo"}
              </button>
            </div>
          </form>
        </div>
      </section>

      <section className="panel" style={{ marginTop: 22 }}>
        <div className="panel-header">
          <h2 className="panel-title">Base de insumos</h2>
          <input
            aria-label="Buscar insumo"
            className="search-input"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar insumo…"
            style={{ maxWidth: 250 }}
            value={search}
          />
        </div>
        {loading ? (
          <div className="loading-state">Carregando insumos…</div>
        ) : filteredInsumos.length === 0 ? (
          <div className="empty-state">
            {insumos.length === 0
              ? "Sua base ainda está vazia. Cadastre o primeiro insumo acima."
              : "Nenhum insumo corresponde à busca."}
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Insumo</th>
                  <th>Compra</th>
                  <th>Fator</th>
                  <th>Custo unitário</th>
                  <th>Estoque</th>
                  <th>Mínimo</th>
                  <th>Fornecedor</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {filteredInsumos.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div className="item-title">{item.nome}</div>
                      <div className="item-subtitle">{item.categoria}</div>
                    </td>
                    <td>
                      {currency.format(item.precoCompra)} / {item.quantidadeCompra}{" "}
                      {item.unidade}
                    </td>
                    <td>{item.fatorCorrecao.toFixed(2)}</td>
                    <td>
                      {currency.format(item.custoUnitario)} / {item.unidade}
                    </td>
                    <td>
                      {(item.quantidadeEstoque ?? 0).toLocaleString("pt-BR")}{" "}
                      {item.unidade}
                    </td>
                    <td>
                      {typeof item.estoqueMinimo === "number" &&
                      item.estoqueMinimo > 0
                        ? `${item.estoqueMinimo.toLocaleString("pt-BR")} ${item.unidade}`
                        : "—"}
                    </td>
                    <td>{item.fornecedor || "—"}</td>
                    <td>
                      <div className="table-actions">
                        <button
                          className="icon-button"
                          onClick={() => startEditing(item)}
                          type="button"
                        >
                          Editar
                        </button>
                        <button
                          className="icon-button"
                          onClick={() => void handleDelete(item)}
                          type="button"
                        >
                          Excluir
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AdminShell>
  );
}
