import {
  collection,
  onSnapshot,
  query,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { getFirebaseServices } from "@/lib/firebase";
import type { Insumo } from "@/types";

type InsumoInput = Omit<Insumo, "id" | "storeId">;

export function observarInsumos(
  storeId: string,
  onChange: (insumos: Insumo[]) => void,
  onError: (error: Error) => void,
  includeFinancials = false,
): Unsubscribe {
  const { db } = getFirebaseServices();
  let baseItems: Insumo[] | null = null;
  let financeById = new Map<string, Record<string, unknown>>();
  let financeLoaded = !includeFinancials;
  const emit = () => {
    if (!baseItems || !financeLoaded) return;
    const insumos = baseItems.map((item) => ({
      ...item,
      ...(financeById.get(item.id) ?? {}),
    }));
    insumos.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    onChange(insumos);
  };
  const stopBase = onSnapshot(
    query(collection(db, "insumos"), where("storeId", "==", storeId)),
    (snapshot) => {
      baseItems = snapshot.docs.map(
        (item) => ({ id: item.id, ...item.data() }) as Insumo,
      );
      emit();
    },
    onError,
  );
  const stopFinance = includeFinancials
    ? onSnapshot(
        query(
          collection(db, "insumoFinancas"),
          where("storeId", "==", storeId),
        ),
        (snapshot) => {
          financeById = new Map(
            snapshot.docs.map((item) => [item.id, item.data()]),
          );
          financeLoaded = true;
          emit();
        },
        onError,
      )
    : undefined;
  return () => {
    stopBase();
    stopFinance?.();
  };
}

export async function criarInsumo(
  storeId: string,
  insumo: InsumoInput,
): Promise<void> {
  await saveIngredient({ operation: "create", storeId, insumo });
}

export async function atualizarInsumo(
  id: string,
  storeId: string,
  insumo: InsumoInput,
): Promise<void> {
  await saveIngredient({ operation: "update", storeId, id, insumo });
}

export async function removerInsumo(id: string, storeId: string): Promise<void> {
  await saveIngredient({ operation: "delete", storeId, id });
}

async function saveIngredient(payload: {
  operation: "create" | "update" | "delete";
  storeId: string;
  id?: string;
  insumo?: InsumoInput;
}) {
  const { auth } = getFirebaseServices();
  const user = auth.currentUser;
  if (!user) throw new Error("Entre novamente para continuar.");
  const response = await fetch("/api/insumos", {
    method: "POST",
    headers: {
      authorization: `Bearer ${await user.getIdToken()}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const result: unknown = await response.json();
  if (!response.ok) {
    const message =
      typeof result === "object" &&
      result !== null &&
      "error" in result &&
      typeof result.error === "string"
        ? result.error
        : "Não foi possível salvar o insumo.";
    throw new Error(message);
  }
}
