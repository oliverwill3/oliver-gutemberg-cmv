import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type Unsubscribe,
} from "firebase/firestore";
import { getFirebaseServices } from "@/lib/firebase";
import type {
  Insumo,
  PurchaseListItem,
  PurchaseListItemStatus,
} from "@/types";

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
        } as PurchaseListItem;
      });
      items.sort((a, b) => a.criadoEm.localeCompare(b.criadoEm));
      onChange(items);
    },
    onError,
  );
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

export async function gerarSugestoesEstoqueMinimo({
  storeId,
  uid,
  email,
  insumos,
  itensExistentes,
}: {
  storeId: string;
  uid: string;
  email: string;
  insumos: Insumo[];
  itensExistentes: PurchaseListItem[];
}): Promise<number> {
  const existingIngredientIds = new Set(
    itensExistentes
      .filter((item) => item.status !== "rejected")
      .map((item) => item.insumoId)
      .filter(Boolean),
  );
  const suggestions = insumos.filter(
    (item) =>
      Number.isFinite(item.estoqueMinimo) &&
      (item.estoqueMinimo ?? 0) > 0 &&
      (item.quantidadeEstoque ?? 0) < (item.estoqueMinimo ?? 0) &&
      !existingIngredientIds.has(item.id),
  );
  if (suggestions.length === 0) return 0;
  if (suggestions.length > MAX_SUGGESTIONS_PER_BATCH) {
    throw new Error("Gere no máximo 450 sugestões por vez.");
  }

  const { db, auth } = getFirebaseServices();
  if (auth.currentUser?.uid !== uid) {
    throw new Error("Sua sessão expirou. Entre novamente para continuar.");
  }
  const batch = writeBatch(db);
  for (const ingredient of suggestions) {
    const ref = doc(itemsRef(storeId));
    batch.set(ref, {
      nome: ingredient.nome,
      quantidade:
        (ingredient.estoqueMinimo ?? 0) - (ingredient.quantidadeEstoque ?? 0),
      unidade: ingredient.unidade,
      categoria: ingredient.categoria,
      insumoId: ingredient.id,
      novoItem: false,
      origem: "automatico",
      status: "requested" satisfies PurchaseListItemStatus,
      observacao: "Sugestão gerada a partir do estoque mínimo cadastrado.",
      criadoPor: uid,
      criadoPorEmail: email,
      criadoEm: serverTimestamp(),
    });
  }
  await batch.commit();
  return suggestions.length;
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
