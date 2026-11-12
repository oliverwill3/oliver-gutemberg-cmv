"use client";

import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";
import { useEffect, useMemo, useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import {
  canApprovePurchaseList,
} from "@/lib/auth/permissions";
import { loadAdminProfile } from "@/lib/auth/admin-profile";
import { getFirebaseServices, isFirebaseConfigured } from "@/lib/firebase";
import {
  adicionarItemListaCompras,
  atualizarDetalhesCompraLista,
  ensureCurrentPurchaseList,
  gerarSugestoesReposicao,
  importarVendasSemanais,
  marcarItemComoComprado,
  observarItensListaCompras,
  observarVendasSemanais,
  revisarItemListaCompras,
} from "@/lib/firestore/purchase-lists";
import {
  observarFichasTecnicas,
  observarProdutos,
} from "@/lib/firestore/fichas-tecnicas";
import { observarInsumos } from "@/lib/firestore/insumos";
import {
  calcularItensReposicao,
  parseWeeklySalesCsv,
} from "@/lib/utils/purchase-planning";
import type {
  FichaTecnica,
  Insumo,
  Produto,
  PurchaseListItem,
  UserProfile,
  UserRole,
  UnidadeMedida,
  VendasSemanais,
} from "@/types";

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

function statusLabel(item: PurchaseListItem) {
  if (item.status === "pending_approval") return "Aguardando aprovação";
  if (item.status === "approved") return "Aprovado para compra";
  if (item.status === "rejected") return "Recusado";
  if (item.status === "purchased") return "Comprado";
  return item.origem === "automatico" ? "Sugestão de reposição" : "Na lista";
}

function formatDate(value: string) {
  if (!value) return "Agora";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Agora"
    : date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function getLocalDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getMondayDateInputValue() {
  const date = new Date();
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return getLocalDateInputValue(date);
}

function parseOptionalMoney(value: FormDataEntryValue | null) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;
  const number = Number(text.replace(",", "."));
  if (!Number.isFinite(number) || number < 0) {
    throw new Error("Informe valores válidos, iguais ou maiores que zero.");
  }
  return number;
}

function formatCurrency(value: number | null | undefined) {
  if (typeof value !== "number") return "Não informado";
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
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
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [fichas, setFichas] = useState<FichaTecnica[]>([]);
  const [vendasSemanais, setVendasSemanais] = useState<VendasSemanais[]>([]);
  const [produtosLoaded, setProdutosLoaded] = useState(false);
  const [fichasLoaded, setFichasLoaded] = useState(false);
  const [vendasLoaded, setVendasLoaded] = useState(false);
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
  const [salesFile, setSalesFile] = useState<File | null>(null);
  const [salesWeekStart, setSalesWeekStart] = useState(getMondayDateInputValue);

  useEffect(() => {
    if (!isFirebaseConfigured) return;
    try {
      return onAuthStateChanged(
        getFirebaseServices().auth,
        (currentUser) => {
          setUser(currentUser);
          setProfile(null);
          setItems(null);
          setInsumos([]);
          setProdutos([]);
          setFichas([]);
          setVendasSemanais([]);
          setProdutosLoaded(false);
          setFichasLoaded(false);
          setVendasLoaded(false);
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
    loadAdminProfile(getFirebaseServices().db, user.uid)
      .then(({ profile: loadedProfile, error }) => {
        if (!active) return;
        if (!loadedProfile) {
          setProfileError(error);
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
    let stopProdutos: (() => void) | undefined;
    let stopFichas: (() => void) | undefined;
    let stopVendas: (() => void) | undefined;
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
          profile.storeId,
          setInsumos,
          (error) => setDataError(getErrorMessage(error)),
        );
        stopProdutos = observarProdutos(
          profile.storeId,
          (records) => {
            setProdutos(records);
            setProdutosLoaded(true);
          },
          (error) => setDataError(getErrorMessage(error)),
        );
        stopFichas = observarFichasTecnicas(
          profile.storeId,
          (records) => {
            setFichas(records);
            setFichasLoaded(true);
          },
          (error) => setDataError(getErrorMessage(error)),
        );
        stopVendas = observarVendasSemanais(
          profile.storeId,
          (records) => {
            setVendasSemanais(records);
            setVendasLoaded(true);
          },
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
      stopProdutos?.();
      stopFichas?.();
      stopVendas?.();
    };
  }, [profile, user]);

  const selectedInsumo = useMemo(
    () => insumos.find((item) => item.id === selectedInsumoId),
    [insumos, selectedInsumoId],
  );
  const canApprove = profile ? canApprovePurchaseList(profile.role) : false;
  const canHandlePurchases =
    profile !== null &&
    ["super_admin", "owner", "manager", "purchasing"].includes(profile.role);
  const canImportSales = canHandlePurchases;
  const planningReady = produtosLoaded && fichasLoaded && vendasLoaded;

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
    if (!user || !profile || !items || !planningReady) return;
    setBusy(true);
    setNotice("");
    setDataError("");
    try {
      const suggestions = calcularItensReposicao({
        insumos,
        fichas,
        vendas: vendasSemanais,
        itensExistentes: items,
      });
      const count = await gerarSugestoesReposicao({
        storeId: profile.storeId,
        uid: user.uid,
        email: user.email ?? "",
        sugestoes: suggestions,
      });
      setNotice(
        count
          ? `${count} sugestão(ões) de reposição adicionada(s), usando estoque mínimo e consumo médio das últimas ${vendasSemanais.length} semana(s).`
          : "Nenhum insumo precisa de reposição ou já existe na lista.",
      );
    } catch (error) {
      setDataError(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleImportSales(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || !profile || !salesFile || !produtosLoaded) return;
    setBusy(true);
    setNotice("");
    setDataError("");
    try {
      const csv = await salesFile.text();
      const rows = parseWeeklySalesCsv(csv, produtos);
      await importarVendasSemanais({
        storeId: profile.storeId,
        semanaInicio: salesWeekStart,
        itens: rows,
        uid: user.uid,
        email: user.email ?? "",
      });
      setNotice(
        `Relatório da semana iniciada em ${salesWeekStart} importado com ${rows.length} produto(s). Se já havia um relatório para essa semana, ele foi substituído.`,
      );
      setSalesFile(null);
    } catch (error) {
      setDataError(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleSavePurchaseDetails(
    event: React.FormEvent<HTMLFormElement>,
    item: PurchaseListItem,
  ) {
    event.preventDefault();
    if (!user || !profile) return;
    const formData = new FormData(event.currentTarget);
    setBusy(true);
    setNotice("");
    setDataError("");
    try {
      await atualizarDetalhesCompraLista({
        storeId: profile.storeId,
        itemId: item.id,
        comentarioCompras: String(formData.get("comentarioCompras") ?? ""),
        valorUnitario: parseOptionalMoney(formData.get("valorUnitario")),
        valorTotal: parseOptionalMoney(formData.get("valorTotal")),
        uid: user.uid,
      });
      setNotice(`Detalhes de compra de "${item.nome}" atualizados.`);
    } catch (error) {
      setDataError(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleMarkPurchased(item: PurchaseListItem) {
    if (!user || !profile) return;
    setBusy(true);
    setNotice("");
    setDataError("");
    try {
      await marcarItemComoComprado({
        storeId: profile.storeId,
        itemId: item.id,
        uid: user.uid,
        email: user.email ?? "",
      });
      setNotice(
        `"${item.nome}" marcado como comprado. O estoque não foi alterado; registre a entrada no recebimento da compra.`,
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
      profile={profile}
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
            Dados → coleção <code>userProfiles</code> ou <code>Usuarios</code>,
            usando o UID deste usuário como ID, com os campos <code>role</code>{" "}
            e <code>storeId</code>.
          </p>
        </div>
      ) : null}
      {dataError ? <div className="notice error">{dataError}</div> : null}
      {notice ? <div className="notice success">{notice}</div> : null}

      {profile ? (
        <>
          {canImportSales ? (
            <section className="panel purchase-request-panel">
              <div className="panel-header">
                <h2 className="panel-title">Importar vendas semanais</h2>
                <span className="status">
                  {vendasSemanais.length} semana(s) recente(s)
                </span>
              </div>
              <div className="panel-body">
                <p className="field-hint">
                  Envie um CSV com as colunas <code>produto</code> e{" "}
                  <code>quantidade</code>. Os nomes precisam corresponder aos
                  produtos do cardápio. A importação da mesma semana substitui o
                  relatório anterior e alimenta a previsão pelas fichas técnicas.
                  Produtos sem ficha técnica ou com unidades incompatíveis ficam
                  fora do cálculo de consumo.
                </p>
                {vendasSemanais.length > 0 ? (
                  <div className="weekly-sales-history">
                    {vendasSemanais.map((report) => (
                      <span className="status" key={report.id}>
                        Semana de {report.semanaInicio} · {report.itens.length}{" "}
                        produto(s)
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="field-hint">
                    Sem relatórios ainda; as primeiras sugestões usarão apenas
                    o estoque mínimo.
                  </div>
                )}
                <form className="form-grid sales-import-form" onSubmit={handleImportSales}>
                  <div className="field">
                    <label htmlFor="sales-week-start">
                      Início da semana (segunda-feira)
                    </label>
                    <input
                      id="sales-week-start"
                      onChange={(event) => setSalesWeekStart(event.target.value)}
                      required
                      type="date"
                      value={salesWeekStart}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="sales-report-file">Arquivo CSV</label>
                    <input
                      accept=".csv,text/csv"
                      id="sales-report-file"
                      key={salesFile?.name ?? "sales-report-empty"}
                      onChange={(event) =>
                        setSalesFile(event.target.files?.[0] ?? null)
                      }
                      required
                      type="file"
                    />
                    <span className="field-hint">
                      Exemplo: <code>produto;quantidade</code>
                    </span>
                  </div>
                  <div className="form-actions field full">
                    <button
                      className="button button-primary"
                      disabled={busy || !salesFile || !produtosLoaded}
                      type="submit"
                    >
                      {busy ? "Importando…" : "Importar relatório"}
                    </button>
                  </div>
                </form>
              </div>
            </section>
          ) : null}

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
                  <strong>Sugestões de reposição</strong>
                  <p className="field-hint">
                    Quantidade sugerida = estoque mínimo + consumo médio semanal
                    pelas últimas quatro vendas importadas - estoque atual. Sem
                    relatório, considera somente o estoque mínimo. Não efetua
                    compras nem movimenta estoque.
                  </p>
                </div>
                <button
                  className="button button-secondary"
                  disabled={busy || !items || !planningReady}
                  onClick={() => void handleGenerateSuggestions()}
                  type="button"
                >
                  {planningReady ? "Gerar sugestões" : "Carregando dados…"}
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
                estoque mínimo e pelas vendas semanais importadas.
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
                          {item.comentarioCompras ? (
                            <div className="item-subtitle">
                              Compras: {item.comentarioCompras}
                            </div>
                          ) : null}
                          {item.valorUnitario != null ||
                          item.valorTotal != null ? (
                            <div className="item-subtitle">
                              Unitário: {formatCurrency(item.valorUnitario)} ·
                              Total: {formatCurrency(item.valorTotal)}
                            </div>
                          ) : null}
                          {item.compradoPorEmail ? (
                            <div className="item-subtitle">
                              Marcado como comprado por {item.compradoPorEmail}
                              {item.compradoEm
                                ? ` · ${formatDate(item.compradoEm)}`
                                : ""}
                            </div>
                          ) : null}
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
                          {canHandlePurchases ? (
                            <div className="purchase-row-actions">
                              <form
                                className="purchase-details-form"
                                key={`${item.comentarioCompras ?? ""}:${item.valorUnitario ?? ""}:${item.valorTotal ?? ""}`}
                                onSubmit={(event) =>
                                  void handleSavePurchaseDetails(event, item)
                                }
                              >
                                <input
                                  aria-label={`Comentário de compras para ${item.nome}`}
                                  defaultValue={item.comentarioCompras ?? ""}
                                  maxLength={500}
                                  name="comentarioCompras"
                                  placeholder="Comentário de compras"
                                />
                                <input
                                  aria-label={`Valor unitário de ${item.nome}`}
                                  defaultValue={item.valorUnitario ?? ""}
                                  min="0"
                                  name="valorUnitario"
                                  placeholder="Valor unitário"
                                  step="0.01"
                                  type="number"
                                />
                                <input
                                  aria-label={`Valor total de ${item.nome}`}
                                  defaultValue={item.valorTotal ?? ""}
                                  min="0"
                                  name="valorTotal"
                                  placeholder="Valor total"
                                  step="0.01"
                                  type="number"
                                />
                                <button
                                  className="icon-button"
                                  disabled={busy}
                                  type="submit"
                                >
                                  Salvar detalhes
                                </button>
                              </form>
                              {["requested", "approved"].includes(item.status) ? (
                                <button
                                  className="icon-button"
                                  disabled={busy}
                                  onClick={() => void handleMarkPurchased(item)}
                                  type="button"
                                >
                                  Marcar comprado
                                </button>
                              ) : null}
                            </div>
                          ) : null}
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
