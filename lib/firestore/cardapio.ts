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
import type { Produto } from "@/types";

const MAX_BATCH_PRODUCTS = 450;

export function observarProdutosCardapio(
  storeId: string,
  onChange: (produtos: Produto[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const { db } = getFirebaseServices();
  return onSnapshot(
    query(collection(db, "produtos"), where("storeId", "==", storeId)),
    (snapshot) => {
      onChange(
        snapshot.docs.map(
          (item) => ({ id: item.id, ...item.data() }) as Produto,
        ),
      );
    },
    onError,
  );
}

export async function salvarOrdemProdutos(
  storeId: string,
  produtos: Pick<Produto, "id">[],
): Promise<void> {
  if (produtos.length === 0) return;
  if (produtos.length > MAX_BATCH_PRODUCTS) {
    throw new Error(
      `Esta categoria tem mais de ${MAX_BATCH_PRODUCTS} produtos. Não foi possível atualizar a ordem em uma única operação.`,
    );
  }
  if (new Set(produtos.map((produto) => produto.id)).size !== produtos.length) {
    throw new Error("A lista contém produtos duplicados.");
  }

  const { db } = getFirebaseServices();
  const batch = writeBatch(db);
  const atualizadoEm = new Date().toISOString();
  produtos.forEach((produto, ordem) => {
    batch.update(doc(db, "produtos", produto.id), {
      storeId,
      ordem,
      atualizadoEm,
    });
  });
  await batch.commit();
}
