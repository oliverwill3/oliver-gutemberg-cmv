import {
  addDoc,
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type Unsubscribe,
} from "firebase/firestore";
import { getFirebaseServices } from "@/lib/firebase";
import type {
  PurchaseListItem,
  PurchaseListItemStatus,
  VendaSemanalItem,
  VendasSemanais,
} from "@/types";
import type { ItemReposicao } from "@/lib/utils/purchase-planning";

const LIST_ID = "current";
const MAX_SUGGESTIONS_PER_BATCH = 450;

function listRef(storeId: string) {
  const { db } = getFirebaseServices();
  return doc(db, "stores", storeId, "purchaseLists", LIST_ID);
}

function itemsRef(storeId: string) {
  const { db } = getFirebaseServices();
  return collection(db, "stores", storeId, "purchaseLists", LIST_ID, "items");
}

function toIsoDate(value: unknown): string {
  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof value.toDate === "function"
  ) {
    return value.toDate().toISOString();
  }
  return typeof value === "string" ? value : "";
}

export async function ensureCurrentPurchaseList(
  storeId: string,
  uid: string,
): Promise<void> {
  const ref = listRef(storeId);
  const current = await getDoc(ref);
  if (current.exists()) return;

  try {
    await setDoc(ref, {
      storeId,
      status: "open",
      createdBy: uid,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    const createdByAnotherMember = await getDoc(ref);
    if (createdByAnotherMember.exists()) return;
    throw error;
  }
}

export function observarItensListaCompras(
  storeId: string,
  onChange: (items: PurchaseListItem[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    itemsRef(storeId),
    (snapshot) => {
      const items = snapshot.docs.map((entry) => {
        const data = entry.data();
        return {
          ...data,
          id: entry.id,
          criadoEm: toIsoDate(data.criadoEm),
          revisadoEm: data.revisadoEm
            ? toIsoDate(data.revisadoEm)
            : undefined,
          compradoEm: data.compradoEm
            ? toIsoDate(data.compradoEm)
            : undefined,
        } as PurchaseListItem;
      });
      items.sort((a, b) => a.criadoEm.localeCompare(b.criadoEm));
      onChange(items);
    },
    onError,
  );
}

export function observarVendasSemanais(
  storeId: string,
  onChange: (reports: VendasSemanais[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const { db } = getFirebaseServices();
  return onSnapshot(
    query(
      collection(db, "stores", storeId, "weeklySales"),
      orderBy("semanaInicio", "desc"),
      limit(4),
    ),
    (snapshot) => {
      onChange(
        snapshot.docs.map((entry) => {
          const data = entry.data();
          return {
            ...data,
            id: entry.id,
            importadoEm: toIsoDate(data.importadoEm),
            itens: Array.isArray(data.itens)
              ? (data.itens as VendaSemanalItem[])
              : [],
          } as VendasSemanais;
        }),
      );
    },
    onError,
  );
}

export async function importarVendasSemanais({
  storeId,
  semanaInicio,
  itens,
  uid,
  email,
}: {
  storeId: string;
  semanaInicio: string;
  itens: VendaSemanalItem[];
  uid: string;
  email: string;
}): Promise<void> {
  const parsedDate = new Date(`${semanaInicio}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(semanaInicio) ||
    Number.isNaN(parsedDate.getTime()) ||
    parsedDate.toISOString().slice(0, 10) !== semanaInicio
  ) {
    throw new Error("Informe uma data válida para o início da semana.");
  }
  if (parsedDate.getUTCDay() !== 1) {
    throw new Error("A data de início da semana deve ser uma segunda-feira.");
  }
  if (itens.length === 0 || itens.length > 300) {
    throw new Error("O relatório deve conter entre 1 e 300 produtos.");
  }
  const productIds = new Set(itens.map((item) => item.produtoId));
  if (
    productIds.size !== itens.length ||
    itens.some(
      (item) =>
        !item.produtoId ||
        !item.produtoNome.trim() ||
        !Number.isFinite(item.unidadesVendidas) ||
        item.unidadesVendidas <= 0,
    )
  ) {
    throw new Error("O relatório contém produtos ou quantidades inválidas.");
  }

  const { auth, db } = getFirebaseServices();
  if (auth.currentUser?.uid !== uid) {
    throw new Error("Sua sessão expirou. Entre novamente para continuar.");
  }
  await setDoc(doc(db, "stores", storeId, "weeklySales", semanaInicio), {
    storeId,
    semanaInicio,
    itens,
    importadoPor: uid,
    importadoPorEmail: email,
    importadoEm: serverTimestamp(),
  });
}

export async function adicionarItemListaCompras({
  storeId,
  nome,
  quantidade,
  unidade,
  categoria,
  insumoId,
  novoItem,
  observacao,
  uid,
  email,
  origem = "manual",
}: {
  storeId: string;
  nome: string;
  quantidade: number;
  unidade: string;
  categoria: string;
  insumoId: string;
  novoItem: boolean;
  observacao: string;
  uid: string;
  email: string;
  origem?: "manual" | "automatico";
}): Promise<void> {
  const normalizedName = nome.trim();
  if (!normalizedName) throw new Error("Informe o nome do item.");
  if (!Number.isFinite(quantidade) || quantidade <= 0) {
    throw new Error("Informe uma quantidade maior que zero.");
  }
  if (!unidade.trim()) throw new Error("Selecione a unidade do item.");
  if (!categoria.trim()) throw new Error("Informe a categoria do item.");
  if (!novoItem && !insumoId) {
    throw new Error("Vincule o item a um insumo cadastrado.");
  }

  const { auth } = getFirebaseServices();
  if (auth.currentUser?.uid !== uid) {
    throw new Error("Sua sessão expirou. Entre novamente para continuar.");
  }
  await addDoc(itemsRef(storeId), {
    nome: normalizedName,
    quantidade,
    unidade: unidade.trim(),
    categoria: categoria.trim(),
    insumoId: novoItem ? "" : insumoId,
    novoItem,
    origem,
    status: novoItem ? "pending_approval" : "requested",
    observacao: observacao.trim(),
    criadoPor: uid,
    criadoPorEmail: email,
    criadoEm: serverTimestamp(),
  });
}

export async function gerarSugestoesReposicao({
  storeId,
  uid,
  email,
  sugestoes,
}: {
  storeId: string;
  uid: string;
  email: string;
  sugestoes: ItemReposicao[];
}): Promise<number> {
  if (sugestoes.length === 0) return 0;
  if (sugestoes.length > MAX_SUGGESTIONS_PER_BATCH) {
    throw new Error("Gere no máximo 450 sugestões por vez.");
  }
  if (
    sugestoes.some(
      (item) =>
        !item.insumoId ||
        !item.nome.trim() ||
        item.nome.length > 150 ||
        !Number.isFinite(item.quantidade) ||
        item.quantidade <= 0 ||
        !item.unidade.trim() ||
        !item.categoria.trim() ||
        item.categoria.length > 100 ||
        item.observacao.length > 500,
    )
  ) {
    throw new Error("Uma ou mais sugestões de reposição são inválidas.");
  }

  const { db, auth } = getFirebaseServices();
  if (auth.currentUser?.uid !== uid) {
    throw new Error("Sua sessão expirou. Entre novamente para continuar.");
  }
  const batch = writeBatch(db);
  for (const suggestion of sugestoes) {
    const ref = doc(itemsRef(storeId));
    batch.set(ref, {
      nome: suggestion.nome,
      quantidade: suggestion.quantidade,
      unidade: suggestion.unidade,
      categoria: suggestion.categoria,
      insumoId: suggestion.insumoId,
      novoItem: false,
      origem: "automatico",
      status: "requested" satisfies PurchaseListItemStatus,
      observacao: suggestion.observacao,
      criadoPor: uid,
      criadoPorEmail: email,
      criadoEm: serverTimestamp(),
    });
  }
  await batch.commit();
  return sugestoes.length;
}

export async function revisarItemListaCompras({
  storeId,
  itemId,
  status,
  uid,
  email,
  decisao,
}: {
  storeId: string;
  itemId: string;
  status: Extract<PurchaseListItemStatus, "approved" | "rejected">;
  uid: string;
  email: string;
  decisao: string;
}): Promise<void> {
  const { auth } = getFirebaseServices();
  if (auth.currentUser?.uid !== uid) {
    throw new Error("Sua sessão expirou. Entre novamente para continuar.");
  }
  await updateDoc(doc(itemsRef(storeId), itemId), {
    status,
    revisadoPor: uid,
    revisadoPorEmail: email,
    revisadoEm: serverTimestamp(),
    decisao: decisao.trim(),
  });
}

export async function atualizarDetalhesCompraLista({
  storeId,
  itemId,
  comentarioCompras,
  valorUnitario,
  valorTotal,
  uid,
}: {
  storeId: string;
  itemId: string;
  comentarioCompras: string;
  valorUnitario: number | null;
  valorTotal: number | null;
  uid: string;
}): Promise<void> {
  const { auth } = getFirebaseServices();
  if (auth.currentUser?.uid !== uid) {
    throw new Error("Sua sessão expirou. Entre novamente para continuar.");
  }
  if (comentarioCompras.length > 500) {
    throw new Error("O comentário pode ter no máximo 500 caracteres.");
  }
  if (
    [valorUnitario, valorTotal].some(
      (value) => value !== null && (!Number.isFinite(value) || value < 0),
    )
  ) {
    throw new Error("Os valores da compra não podem ser negativos.");
  }
  await updateDoc(doc(itemsRef(storeId), itemId), {
    comentarioCompras: comentarioCompras.trim(),
    valorUnitario,
    valorTotal,
  });
}

export async function marcarItemComoComprado({
  storeId,
  itemId,
  uid,
  email,
}: {
  storeId: string;
  itemId: string;
  uid: string;
  email: string;
}): Promise<void> {
  const { auth } = getFirebaseServices();
  if (auth.currentUser?.uid !== uid) {
    throw new Error("Sua sessão expirou. Entre novamente para continuar.");
  }
  await updateDoc(doc(itemsRef(storeId), itemId), {
    status: "purchased" satisfies PurchaseListItemStatus,
    compradoPor: uid,
    compradoPorEmail: email,
    compradoEm: serverTimestamp(),
  });
}
