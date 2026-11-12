import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
  writeBatch,
  type Unsubscribe,
} from "firebase/firestore";
import { getFirebaseServices } from "@/lib/firebase";
import type {
  ClassificacaoCompraItem,
  Compra,
  ItemCompra,
  ItemCardapioImportado,
} from "@/types";

export interface NotaImportacaoInput {
  fornecedor: string;
  numeroNota: string;
  dataEmissao: string;
  nomeArquivo: string;
  itens: ItemCompra[];
}

export interface ItemCardapioInput {
  nomeProduto: string;
  descricao: string;
  quantidade: number | null;
  unidade: ItemCompra["unidade"];
  preco: number | null;
  categoria: string;
}

export async function importarItensCardapio(
  storeId: string,
  usuarioId: string,
  items: ItemCardapioInput[],
): Promise<string[]> {
  if (items.length === 0) throw new Error("Adicione ao menos um produto.");
  if (items.length > 300) throw new Error("Importe no máximo 300 produtos por vez.");
  for (const [index, item] of items.entries()) {
    if (!item.nomeProduto.trim()) {
      throw new Error(`Informe o nome do produto ${index + 1}.`);
    }
    if (!item.categoria.trim()) {
      throw new Error(`Informe a categoria de "${item.nomeProduto}".`);
    }
    if (item.preco === null || !Number.isFinite(item.preco) || item.preco < 0) {
      throw new Error(`Informe um preço válido para "${item.nomeProduto}".`);
    }
    if (
      item.quantidade !== null &&
      (!Number.isFinite(item.quantidade) || item.quantidade <= 0)
    ) {
      throw new Error(`Informe uma quantidade válida para "${item.nomeProduto}".`);
    }
  }

  const { db } = getFirebaseServices();
  const batch = writeBatch(db);
  const refs = items.map(() => doc(collection(db, "items")));
  const importadoEm = new Date().toISOString();
  for (const [index, item] of items.entries()) {
    batch.set(refs[index], {
      storeId,
      nomeProduto: item.nomeProduto.trim(),
      descricao: item.descricao.trim(),
      quantidade: item.quantidade,
      unidade: item.unidade,
      preco: item.preco,
      categoria: item.categoria.trim(),
      status: "aguardando_revisao",
      origem: "importacao_ocr",
      usuarioId,
      importadoEm,
    } satisfies Omit<ItemCardapioImportado, "id"> & {
      status: string;
      origem: string;
    });
  }
  await batch.commit();
  return refs.map((item) => item.id);
}

export function observarCompras(
  storeId: string,
  onChange: (compras: Compra[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const { db } = getFirebaseServices();
  return onSnapshot(
    query(collection(db, "compras"), where("storeId", "==", storeId)),
    (snapshot) => {
      const compras = snapshot.docs.map(
        (item) => ({ id: item.id, ...item.data() }) as Compra,
      );
      compras.sort((a, b) => b.criadaEm.localeCompare(a.criadaEm));
      onChange(compras);
    },
    onError,
  );
}

export async function confirmarCompra(
  storeId: string,
  confirmacao: NotaImportacaoInput,
): Promise<string> {
  const { auth } = getFirebaseServices();
  const user = auth.currentUser;
  if (!user) throw new Error("Entre novamente para continuar.");
  const response = await fetch("/api/compras/confirmar", {
    method: "POST",
    headers: {
      authorization: `Bearer ${await user.getIdToken()}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ storeId, confirmacao }),
  });
  const result: unknown = await response.json();
  if (!response.ok || typeof result !== "object" || result === null) {
    const message =
      typeof result === "object" &&
      result !== null &&
      "error" in result &&
      typeof result.error === "string"
        ? result.error
        : "Não foi possível confirmar a compra.";
    throw new Error(message);
  }
  if (!("id" in result) || typeof result.id !== "string") {
    throw new Error("O servidor não retornou o identificador da compra.");
  }
  return result.id;
}

export function isClassificacaoCompra(
  value: string,
): value is ClassificacaoCompraItem {
  return value === "insumo_producao" || value === "compra_geral";
}
