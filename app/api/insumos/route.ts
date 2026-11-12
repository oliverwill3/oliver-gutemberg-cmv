import { NextRequest } from "next/server";
import {
  apiErrorResponse,
  authenticateAdminRequest,
  authorizeStoreRole,
} from "@/lib/auth/server-profile";
import { adminDb } from "@/lib/firebase/admin";
import type { UnidadeMedida } from "@/types";

export const runtime = "nodejs";

const units: UnidadeMedida[] = [
  "kg",
  "g",
  "L",
  "ml",
  "unidade",
  "pacote",
  "caixa",
];
const manageableRoles = ["super_admin", "owner", "manager", "purchasing"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredText(value: unknown, label: string, maximum: number): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.trim().length > maximum
  ) {
    throw new Error(`${label} inválido.`);
  }
  return value.trim();
}

function requiredNumber(value: unknown, label: string, minimum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum) {
    throw new Error(`${label} inválido.`);
  }
  return value;
}

export async function POST(request: NextRequest) {
  try {
    const profile = await authenticateAdminRequest(request);
    const body: unknown = await request.json();
    if (!isRecord(body)) throw new Error("Dados do insumo inválidos.");
    const storeId = requiredText(body.storeId, "Loja", 100);
    authorizeStoreRole(profile, storeId, [...manageableRoles]);
    const operation = body.operation;
    if (!["create", "update", "delete"].includes(String(operation))) {
      throw new Error("Operação de insumo inválida.");
    }

    if (operation === "delete") {
      const id = requiredText(body.id, "ID do insumo", 150);
      const ingredientRef = adminDb.collection("insumos").doc(id);
      const financeRef = adminDb.collection("insumoFinancas").doc(id);
      await adminDb.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ingredientRef);
        if (!snapshot.exists || snapshot.get("storeId") !== storeId) {
          throw new Error("O insumo não pertence à loja selecionada.");
        }
        const recipeIds = snapshot.get("fichasTecnicasIds");
        if (Array.isArray(recipeIds) && recipeIds.length > 0) {
          throw new Error(
            "Remova este insumo das fichas técnicas vinculadas antes de excluí-lo.",
          );
        }
        transaction.delete(ingredientRef);
        transaction.delete(financeRef);
      });
      return Response.json({ success: true });
    }

    const data = body.insumo;
    if (!isRecord(data)) throw new Error("Preencha os dados do insumo.");
    const nome = requiredText(data.nome, "Nome", 150);
    const categoria = requiredText(data.categoria, "Categoria", 100);
    if (typeof data.unidade !== "string" || !units.includes(data.unidade as UnidadeMedida)) {
      throw new Error("Unidade de medida inválida.");
    }
    const unidade = data.unidade as UnidadeMedida;
    const quantidadeCompra = requiredNumber(
      data.quantidadeCompra,
      "Quantidade de compra",
      Number.MIN_VALUE,
    );
    const precoCompra = requiredNumber(data.precoCompra, "Preço de compra", 0);
    const fatorCorrecao = requiredNumber(data.fatorCorrecao, "Fator de correção", 1);
    const estoqueMinimo = requiredNumber(data.estoqueMinimo ?? 0, "Estoque mínimo", 0);
    const custoUnitario = (precoCompra / quantidadeCompra) * fatorCorrecao;
    if (!Number.isFinite(custoUnitario)) {
      throw new Error("O custo unitário calculado não é válido.");
    }
    const fornecedor =
      typeof data.fornecedor === "string" ? data.fornecedor.trim() : "";
    if (fornecedor.length > 150) throw new Error("Fornecedor muito longo.");
    const atualizadoEm = new Date().toISOString();
    const baseData = {
      storeId,
      nome,
      categoria,
      unidade,
      estoqueMinimo,
      atualizadoEm,
    };
    const financeData = {
      storeId,
      quantidadeCompra,
      precoCompra,
      fatorCorrecao,
      custoUnitario,
      fornecedor,
      atualizadoEm,
    };

    if (operation === "create") {
      const ingredientRef = adminDb.collection("insumos").doc();
      const batch = adminDb.batch();
      batch.create(ingredientRef, {
        ...baseData,
        quantidadeEstoque: 0,
        fichasTecnicasIds: [],
      });
      batch.create(
        adminDb.collection("insumoFinancas").doc(ingredientRef.id),
        financeData,
      );
      await batch.commit();
      return Response.json({ success: true, id: ingredientRef.id });
    }

    const id = requiredText(body.id, "ID do insumo", 150);
    const ingredientRef = adminDb.collection("insumos").doc(id);
    const financeRef = adminDb.collection("insumoFinancas").doc(id);
    await adminDb.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ingredientRef);
      if (!snapshot.exists || snapshot.get("storeId") !== storeId) {
        throw new Error("O insumo não pertence à loja selecionada.");
      }
      const protectedData: Record<string, unknown> = {
        ...baseData,
        quantidadeEstoque: snapshot.get("quantidadeEstoque") ?? 0,
        fichasTecnicasIds: snapshot.get("fichasTecnicasIds") ?? [],
      };
      transaction.set(ingredientRef, protectedData);
      transaction.set(financeRef, financeData);
    });
    return Response.json({ success: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
