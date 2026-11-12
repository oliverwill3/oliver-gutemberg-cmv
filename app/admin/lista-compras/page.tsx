"use client";

import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { getFirebaseServices, isFirebaseConfigured } from "@/lib/firebase";
import {
  adicionarItemListaCompras,
  ensureCurrentPurchaseList,
  gerarSugestoesEstoqueMinimo,
  observarItensListaCompras,
  revisarItemListaCompras,
} from "@/lib/firestore/purchase-lists";
import { observarInsumos } from "@/lib/firestore/insumos";
import type {
  Insumo,
  PurchaseListItem,
  UserProfile,
  UserRole,
  UnidadeMedida,
} from "@/types";

const roles: UserRole[] = [
  "super_admin",
  "owner",
  "manager",
  "purchasing",
  "kitchen_bar",
];
const roleLabels: Record<UserRole, string> = {
  super_admin: "Administrador global",
  owner: "Proprietário",
  manager: "Gerente",
  purchasing: "Compras",
  kitchen_bar: "Cozinha / bar",
};
const units: UnidadeMedida[] = [
  "kg",
  "g",
  "L",
  "ml",
  "unidade",
  "pacote",
  "caixa",
];

type ItemMode = "catalog" | "new";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Ocorreu um erro inesperado.";
}

function profileFrom(value: unknown, uid: string): UserProfile | null {
  if (typeof value !== "object" || value === null) return null;
  const data = value as Record<string, unknown>;
  if (
    typeof data.role !== "string" ||
    !roles.includes(data.role as UserRole) ||
    typeof data.storeId !== "string" ||
    !data.storeId.trim() ||
    data.storeId.includes("/")
  ) {
    return null;
  }
  return { uid, role: data.role as UserRole, storeId: data.storeId };
}

function statusLabel(item: PurchaseListItem) {
  if (item.status === "pending_approval") return "Aguardando aprovação";
  if (item.status === "approved") return "Aprovado para compra";
  if (item.status === "rejected") return "Recusado";
  return item.origem === "automatico" ? "Sugestão de reposição" : "Na lista";
}

function formatDate(value: string) {
  if (!value) return "Agora";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Agora"
    : date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export default function ListaComprasPage() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(isFirebaseConfigured);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileError, setProfileError] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [items, setItems] = useState<PurchaseListItem[] | null>(null);
  const [insumos, setInsumos] = useState<Insumo[]>([]);
  const [dataError, setDataError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<ItemMode>("catalog");
  const [selectedInsumoId, setSelectedInsumoId] = useState("");
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState<UnidadeMedida>("unidade");
  const [observation, setObservation] = useState("");

  useEffect(() => {
    if (!isFirebaseConfigured) return;
    try {
      return onAuthStateChanged(
        getFirebaseServices().auth,
        (currentUser) => {
          setUser(currentUser);
          setProfile(null);
          setItems(null);
          setProfileError("");
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
    if (!user) return;
    let active = true;
    getDoc(doc(getFirebaseServices().db, "userProfiles", user.uid))
      .then((snapshot) => {
        if (!active) return;
        if (!snapshot.exists()) {
          setProfileError(
            "Seu usuário autenticou, mas ainda não tem perfil operacional. Um administrador precisa cadastrar userProfiles/" +
              user.uid +
              " no Firestore.",
          );
          return;
        }
        const loadedProfile = profileFrom(snapshot.data(), user.uid);
        if (!loadedProfile) {
          setProfileError(
            "O perfil precisa conter um role válido e um storeId não vazio.",
          );
          return;
        }
        setProfile(loadedProfile);
        setProfileError("");
      })
      .catch((error: unknown) => {
        if (active) setProfileError(getErrorMessage(error));
      });
    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    if (!profile || !user) return;
    let stopItems: (() => void) | undefined;
    let stopInsumos: (() => void) | undefined;
    let active = true;

    ensureCurrentPurchaseList(profile.storeId, user.uid)
      .then(() => {
        if (!active) return;
        stopItems = observarItensListaCompras(
          profile.storeId,
          setItems,
          (error) => setDataError(getErrorMessage(error)),
        );
        stopInsumos = observarInsumos(
          setInsumos,
          (error) => setDataError(getErrorMessage(error)),
        );
      })
      .catch((error: unknown) => {
        if (active) {
          setDataError(getErrorMessage(error));
          setItems([]);
        }
      });
    return () => {
      active = false;
      stopItems?.();
      stopInsumos?.();
    };
  }, [profile, user]);

  const selectedInsumo = useMemo(
    () => insumos.find((item) => item.id === selectedInsumoId),
    [insumos, selectedInsumoId],
  );
  const canApprove =
    profile?.role === "super_admin" ||
    profile?.role === "owner" ||
    profile?.role === "manager";

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
    } catch (error) {
      setDataError(getErrorMessage(error));
    }
  }

  async function handleAddItem(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || !profile) return;
    setBusy(true);
    setNotice("");
    setDataError("");
    try {
      await adicionarItemListaCompras({
        storeId: profile.storeId,
        uid: user.uid,
        email: user.email ?? "",
        nome: mode === "catalog" ? selectedInsumo?.nome ?? "" : newName,
        quantidade: Number(quantity),
        unidade: mode === "catalog" ? selectedInsumo?.unidade ?? "" : unit,
        categoria:
          mode === "catalog" ? selectedInsumo?.categoria ?? "" : newCategory,
        insumoId: mode === "catalog" ? selectedInsumoId : "",
        novoItem: mode === "new",
        observacao: observation,
      });
      setNotice(
        mode === "new"
          ? "Novo item enviado. Ele fica pendente até aprovação de um proprietário ou gerente."
          : "Item adicionado à lista compartilhada.",
      );
      setNewName("");
      setNewCategory("");
      setQuantity("");
      setObservation("");
    } catch (error) {
      setDataError(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleGenerateSuggestions() {
    if (!user || !profile || !items) return;
    setBusy(true);
    setNotice("");
    setDataError("");
    try {
      const count = await gerarSugestoesEstoqueMinimo({
        storeId: profile.storeId,
        uid: user.uid,
        email: user.email ?? "",
        insumos,
        itensExistentes: items,
      });
      setNotice(
        count
          ? `${count} sugestão(ões) de reposição adicionada(s) à lista.`
          : "Nenhum insumo está abaixo do estoque mínimo ou já há sugestões abertas.",
      );
    } catch (error) {
      setDataError(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleReview(
    item: PurchaseListItem,
    status: "approved" | "rejected",
  ) {
    if (!user || !profile) return;
    const decisao = window.prompt(
      status === "rejected"
        ? "Informe o motivo da recusa:"
        : "Observação da aprovação (opcional):",
    );
    if (decisao === null) return;
    if (status === "rejected" && !decisao.trim()) {
      setDataError("Informe o motivo para recusar um novo item.");
      return;
    }
    setBusy(true);
    setNotice("");
    setDataError("");
    try {
      await revisarItemListaCompras({
        storeId: profile.storeId,
        itemId: item.id,
        status,
        uid: user.uid,
        email: user.email ?? "",
        decisao,
      });
      setNotice(
        status === "approved"
          ? "Item aprovado para inclusão na lista de compras."
          : "Solicitação recusada; a decisão ficou registrada.",
      );
    } catch (error) {
      setDataError(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  if (!isFirebaseConfigured) {
    return (
      <AdminShell>
        <div className="notice">
          Configure o Firebase Authentication e o Cloud Firestore antes de usar
          a lista compartilhada.
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
        <p className="page-subtitle">
          Entre com o usuário do Firebase Authentication.
        </p>
        {authError ? <div className="notice error">{authError}</div> : null}
        <form className="form-grid" onSubmit={handleLogin}>
          <div className="field full">
            <label htmlFor="purchase-list-email">E-mail</label>
            <input
              autoComplete="email"
              id="purchase-list-email"
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </div>
          <div className="field full">
            <label htmlFor="purchase-list-password">Senha</label>
            <input
              autoComplete="current-password"
              id="purchase-list-password"
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
      userEmail={user.email ?? "Usuário"}
    >
      <div className="page-heading">
        <div>
          <div className="eyebrow">Operação · Suprimentos</div>
          <h1 className="page-title">Lista de compras</h1>
          <p className="page-subtitle">
            Sugestões de reposição e pedidos da equipe em uma lista compartilhada.
            Itens novos precisam de aprovação; a lista não efetua compras.
          </p>
        </div>
        {profile ? (
          <span className="status">
            {roleLabels[profile.role]} · {profile.storeId}
          </span>
        ) : null}
      </div>

      {user && !profile && !profileError ? (
        <div className="panel loading-state">Carregando seu perfil de acesso…</div>
      ) : null}
      {profileError ? (
        <div className="notice error">
          {profileError}
          <p>
            Cadastre o documento no Firebase Console em Firestore Database →
            Dados → coleção <code>userProfiles</code>, usando o UID deste
            usuário como ID.
          </p>
        </div>
      ) : null}
      {dataError ? <div className="notice error">{dataError}</div> : null}
      {notice ? <div className="notice success">{notice}</div> : null}

      {profile ? (
        <>
          <section className="panel purchase-request-panel">
            <div className="panel-header">
              <h2 className="panel-title">Adicionar à lista</h2>
            </div>
            <div className="panel-body">
              <div aria-label="Tipo de item" className="target-options">
                <button
                  aria-pressed={mode === "catalog"}
                  className={`category-chip${mode === "catalog" ? " selected" : ""}`}
                  disabled={busy}
                  onClick={() => setMode("catalog")}
                  type="button"
                >
                  Insumo cadastrado
                </button>
                <button
                  aria-pressed={mode === "new"}
                  className={`category-chip${mode === "new" ? " selected" : ""}`}
                  disabled={busy}
                  onClick={() => setMode("new")}
                  type="button"
                >
                  Solicitar item novo
                </button>
              </div>
              {mode === "new" ? (
                <div className="notice">
                  O item ficará pendente para revisão de proprietário ou gerente.
                  Aprovação libera o item para compra, mas não cria estoque nem
                  registra uma compra.
                </div>
              ) : null}
              <form className="form-grid" onSubmit={handleAddItem}>
                {mode === "catalog" ? (
                  <div className="field full">
                    <label htmlFor="purchase-list-ingredient">Insumo</label>
                    <select
                      id="purchase-list-ingredient"
                      onChange={(event) => setSelectedInsumoId(event.target.value)}
                      required
                      value={selectedInsumoId}
                    >
                      <option value="">Selecione um insumo cadastrado</option>
                      {insumos.map((ingredient) => (
                        <option key={ingredient.id} value={ingredient.id}>
                          {ingredient.nome} · {ingredient.categoria}
                        </option>
                      ))}
                    </select>
                    {selectedInsumo ? (
                      <span className="field-hint">
                        Estoque atual: {selectedInsumo.quantidadeEstoque ?? 0}{" "}
                        {selectedInsumo.unidade}
                        {typeof selectedInsumo.estoqueMinimo === "number"
                          ? ` · Mínimo: ${selectedInsumo.estoqueMinimo} ${selectedInsumo.unidade}`
                          : ""}
                      </span>
                    ) : null}
                  </div>
                ) : (
                  <>
                    <div className="field">
                      <label htmlFor="purchase-list-new-name">Nome do item</label>
                      <input
                        id="purchase-list-new-name"
                        onChange={(event) => setNewName(event.target.value)}
                        required
                        value={newName}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="purchase-list-new-category">Categoria/setor</label>
                      <input
                        id="purchase-list-new-category"
                        onChange={(event) => setNewCategory(event.target.value)}
                        placeholder="Ex.: Limpeza, bar, cozinha"
                        required
                        value={newCategory}
                      />
                    </div>
                  </>
                )}
                <div className="field">
                  <label htmlFor="purchase-list-quantity">Quantidade</label>
                  <input
                    id="purchase-list-quantity"
                    min="0.001"
                    onChange={(event) => setQuantity(event.target.value)}
                    required
                    step="any"
                    type="number"
                    value={quantity}
                  />
                </div>
                {mode === "new" ? (
                  <div className="field">
                    <label htmlFor="purchase-list-unit">Unidade</label>
                    <select
                      id="purchase-list-unit"
                      onChange={(event) =>
                        setUnit(event.target.value as UnidadeMedida)
                      }
                      value={unit}
                    >
                      {units.map((unitOption) => (
                        <option key={unitOption} value={unitOption}>
                          {unitOption}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="field">
                    <label>Unidade</label>
                    <div className="status">
                      {selectedInsumo?.unidade ?? "Selecione um insumo"}
                    </div>
                  </div>
                )}
                <div className="field full">
                  <label htmlFor="purchase-list-observation">
                    Observação (opcional)
                  </label>
                  <input
                    id="purchase-list-observation"
                    onChange={(event) => setObservation(event.target.value)}
                    placeholder="Marca, motivo ou especificação"
                    value={observation}
                  />
                </div>
                <div className="form-actions field full">
                  <button
                    className="button button-primary"
                    disabled={busy || (mode === "catalog" && !selectedInsumo)}
                    type="submit"
                  >
                    {busy
                      ? "Salvando…"
                      : mode === "new"
                        ? "Enviar para aprovação"
                        : "Adicionar à lista"}
                  </button>
                </div>
              </form>
              <div className="purchase-list-auto">
                <div>
                  <strong>Sugestões por estoque mínimo</strong>
                  <p className="field-hint">
                    Adiciona insumos cadastrados abaixo do mínimo. Não é uma
                    previsão de vendas nem um pedido de compra.
                  </p>
                </div>
                <button
                  className="button button-secondary"
                  disabled={busy || !items}
                  onClick={() => void handleGenerateSuggestions()}
                  type="button"
                >
                  Gerar sugestões
                </button>
              </div>
            </div>
          </section>

          <section className="panel purchase-list-panel">
            <div className="panel-header">
              <h2 className="panel-title">Lista compartilhada da loja</h2>
              <span className="status">
                {items?.length ?? 0} {items?.length === 1 ? "item" : "itens"}
              </span>
            </div>
            {items === null ? (
              <div className="loading-state">Carregando lista…</div>
            ) : items.length === 0 ? (
              <div className="empty-state">
                A lista está vazia. Adicione uma demanda ou gere sugestões pelo
                estoque mínimo.
              </div>
            ) : (
              <div className="table-wrap">
                <table className="data-table purchase-list-table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Quantidade</th>
                      <th>Origem / estado</th>
                      <th>Solicitado por</th>
                      <th>Data</th>
                      <th>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <div className="item-title">{item.nome}</div>
                          <div className="item-subtitle">
                            {item.categoria}
                            {item.observacao ? ` · ${item.observacao}` : ""}
                          </div>
                          {item.revisadoPorEmail ? (
                            <div className="item-subtitle">
                              Revisado por {item.revisadoPorEmail}
                              {item.decisao ? ` · ${item.decisao}` : ""}
                            </div>
                          ) : null}
                        </td>
                        <td>
                          {item.quantidade} {item.unidade}
                        </td>
                        <td>
                          <span
                            className={`purchase-list-status ${item.status}`}
                          >
                            {statusLabel(item)}
                          </span>
                        </td>
                        <td>{item.criadoPorEmail || item.criadoPor}</td>
                        <td>{formatDate(item.criadoEm)}</td>
                        <td>
                          {canApprove && item.status === "pending_approval" ? (
                            <div className="table-actions">
                              <button
                                className="icon-button"
                                disabled={busy}
                                onClick={() =>
                                  void handleReview(item, "approved")
                                }
                                type="button"
                              >
                                Aprovar
                              </button>
                              <button
                                className="icon-button"
                                disabled={busy}
                                onClick={() =>
                                  void handleReview(item, "rejected")
                                }
                                type="button"
                              >
                                Recusar
                              </button>
                            </div>
                          ) : item.status === "pending_approval" ? (
                            <span className="field-hint">Aguardando gestor</span>
                          ) : (
                            <span className="field-hint">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}
    </AdminShell>
  );
}
