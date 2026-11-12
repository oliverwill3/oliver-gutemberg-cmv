import {
  collection,
  onSnapshot,
  query,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { getFirebaseServices } from "@/lib/firebase";
import type {
  FichaTecnica,
  Produto,
  TipoMetaPrecificacao,
} from "@/types";

export interface FichaTecnicaInput {
  storeId: string;
  produto: Produto;
  itens: Array<{ insumoId: string; quantidade: number }>;
  rendimento: number;
  precoVenda: number;
  tipoMeta: TipoMetaPrecificacao;
  percentualMeta: number;
}

async function postRecipe(
  operation: "save" | "delete",
  payload: Record<string, unknown>,
): Promise<void> {
  const { auth } = getFirebaseServices();
  const user = auth.currentUser;
  if (!user) throw new Error("Entre novamente para continuar.");
  const response = await fetch("/api/fichas-tecnicas", {
    method: "POST",
    headers: {
      authorization: `Bearer ${await user.getIdToken()}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ ...payload, operation }),
  });
  const result: unknown = await response.json();
  if (!response.ok) {
    const message =
      typeof result === "object" &&
      result !== null &&
      "error" in result &&
      typeof result.error === "string"
        ? result.error
        : "Não foi possível salvar a ficha técnica.";
    throw new Error(message);
  }
}

export async function salvarFichaTecnica(input: FichaTecnicaInput): Promise<void> {
  await postRecipe("save", {
    storeId: input.storeId,
    produtoId: input.produto.id,
    itens: input.itens,
    rendimento: input.rendimento,
    precoVenda: input.precoVenda,
    tipoMeta: input.tipoMeta,
    percentualMeta: input.percentualMeta,
  });
}

export async function removerFichaTecnica(
  produtoId: string,
  storeId: string,
): Promise<void> {
  await postRecipe("delete", { produtoId, storeId });
}

export function observarProdutos(
  storeId: string,
  onChange: (produtos: Produto[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const { db } = getFirebaseServices();
  return onSnapshot(
    query(collection(db, "produtos"), where("storeId", "==", storeId)),
    (snapshot) => {
      const produtos = snapshot.docs.map(
        (item) => ({ id: item.id, ...item.data() }) as Produto,
      );
      produtos.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
      onChange(produtos);
    },
    onError,
  );
}

export function observarFichasTecnicas(
  storeId: string,
  onChange: (fichas: FichaTecnica[]) => void,
  onError: (error: Error) => void,
  includeFinancials = false,
): Unsubscribe {
  const { db } = getFirebaseServices();
  let baseRecipes: FichaTecnica[] | null = null;
  let financeById = new Map<string, Record<string, unknown>>();
  let financeLoaded = !includeFinancials;
  const emit = () => {
    if (!baseRecipes || !financeLoaded) return;
    onChange(
      baseRecipes.map((recipe) => {
        const finance = financeById.get(recipe.id);
        const financialItems = Array.isArray(finance?.itens)
          ? new Map(
              finance.itens.flatMap((item) =>
                typeof item === "object" &&
                item !== null &&
                "insumoId" in item &&
                typeof item.insumoId === "string"
                  ? [[item.insumoId, item as Record<string, unknown>]]
                  : [],
              ),
            )
          : new Map<string, Record<string, unknown>>();
        return {
          ...recipe,
          ...(finance ?? {}),
          itens: recipe.itens.map((item) => ({
            ...item,
            ...(financialItems.get(item.insumoId) ?? {}),
          })),
        };
      }),
    );
  };
  const stopRecipes = onSnapshot(
    query(collection(db, "fichasTecnicas"), where("storeId", "==", storeId)),
    (snapshot) => {
      baseRecipes = snapshot.docs.map(
        (item) => ({ id: item.id, ...item.data() }) as FichaTecnica,
      );
      emit();
    },
    onError,
  );
  const stopFinance = includeFinancials
    ? onSnapshot(
        query(
          collection(db, "fichaTecnicaFinancas"),
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
    stopRecipes();
    stopFinance?.();
  };
}
