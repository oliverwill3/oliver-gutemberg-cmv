import { NextRequest } from "next/server";
import {
  apiErrorResponse,
  authenticateAdminRequest,
  authorizeStoreRole,
} from "@/lib/auth/server-profile";
import { adminDb } from "@/lib/firebase/admin";
import { calculateRecipeCosting } from "@/lib/utils/recipe-costing";
import type { TipoMetaPrecificacao, UnidadeMedida } from "@/types";

export const runtime = "nodejs";

const editorRoles = ["super_admin", "owner", "manager", "kitchen_bar"] as const;
const financeRoles = ["super_admin", "owner", "manager", "purchasing"];
const units: UnidadeMedida[] = [
  "kg",
  "g",
  "L",
  "ml",
  "unidade",
  "pacote",
  "caixa",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredId(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9_-]{1,150}$/.test(value)
  ) {
    throw new Error(`${label} inválido.`);
  }
  return value;
}

function requiredNumber(value: unknown, label: string, minimum: number): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum
  ) {
    throw new Error(`${label} inválido.`);
  }
  return value;
}

export async function POST(request: NextRequest) {
  try {
    const profile = await authenticateAdminRequest(request);
    const body: unknown = await request.json();
    if (!isRecord(body)) throw new Error("Dados da ficha técnica inválidos.");
    const storeId = requiredId(body.storeId, "Loja");
    authorizeStoreRole(profile, storeId, [...editorRoles]);
    const operation = body.operation;
    const productId = requiredId(body.produtoId, "Produto");
    const recipeRef = adminDb.collection("fichasTecnicas").doc(productId);
    const financeRef = adminDb.collection("fichaTecnicaFinancas").doc(productId);

    if (operation === "delete") {
      await adminDb.runTransaction(async (transaction) => {
        const recipeSnapshot = await transaction.get(recipeRef);
        if (!recipeSnapshot.exists || recipeSnapshot.get("storeId") !== storeId) {
          throw new Error("A ficha não pertence à loja selecionada.");
        }
        const oldItems: unknown = recipeSnapshot.get("itens");
        const ingredientIds = Array.isArray(oldItems)
          ? [...new Set(
              oldItems.flatMap((item) =>
                isRecord(item) && typeof item.insumoId === "string"
                  ? [item.insumoId]
                  : [],
              ),
            )]
          : [];
        const ingredientRefs = ingredientIds.map((id) =>
          adminDb.collection("insumos").doc(id),
        );
        const ingredientSnapshots = await Promise.all(
          ingredientRefs.map((ref) => transaction.get(ref)),
        );
        for (const snapshot of ingredientSnapshots) {
          if (!snapshot.exists || snapshot.get("storeId") !== storeId) continue;
          const linked = snapshot.get("fichasTecnicasIds");
          transaction.update(snapshot.ref, {
            fichasTecnicasIds: Array.isArray(linked)
              ? linked.filter((id) => id !== productId)
              : [],
          });
        }
        transaction.delete(recipeRef);
        transaction.delete(financeRef);
        transaction.delete(adminDb.collection("produtoCustos").doc(productId));
      });
      return Response.json({ success: true });
    }

    if (operation !== "save") throw new Error("Operação de ficha inválida.");
    if (!Array.isArray(body.itens) || body.itens.length === 0 || body.itens.length > 100) {
      throw new Error("A ficha deve conter de 1 a 100 insumos.");
    }
    const submittedItems = body.itens.map((value) => {
      if (!isRecord(value)) throw new Error("Um item da ficha é inválido.");
      return {
        insumoId: requiredId(value.insumoId, "Insumo"),
        quantidade: requiredNumber(value.quantidade, "Quantidade", Number.MIN_VALUE),
      };
    });
    const productRef = adminDb.collection("produtos").doc(productId);

    await adminDb.runTransaction(async (transaction) => {
      const [productSnapshot, recipeSnapshot, financeSnapshot] =
        await Promise.all([
          transaction.get(productRef),
          transaction.get(recipeRef),
          transaction.get(financeRef),
        ]);
      if (!productSnapshot.exists || productSnapshot.get("storeId") !== storeId) {
        throw new Error("O produto não pertence à loja selecionada.");
      }

      const oldItems: unknown = recipeSnapshot.get("itens");
      const oldIngredientIds = Array.isArray(oldItems)
        ? oldItems.flatMap((item) =>
            isRecord(item) && typeof item.insumoId === "string"
              ? [item.insumoId]
              : [],
          )
        : [];
      const ingredientIds = [
        ...new Set([
          ...submittedItems.map((item) => item.insumoId),
          ...oldIngredientIds,
        ]),
      ];
      const ingredientRefs = ingredientIds.map((id) =>
        adminDb.collection("insumos").doc(id),
      );
      const financeRefs = submittedItems.map((item) =>
        adminDb.collection("insumoFinancas").doc(item.insumoId),
      );
      const [ingredientSnapshots, ingredientFinanceSnapshots] =
        await Promise.all([
          Promise.all(ingredientRefs.map((ref) => transaction.get(ref))),
          Promise.all(financeRefs.map((ref) => transaction.get(ref))),
        ]);
      const ingredients = new Map(
        ingredientSnapshots.map((snapshot) => [snapshot.id, snapshot]),
      );
      const ingredientFinancials = new Map(
        ingredientFinanceSnapshots.map((snapshot) => [snapshot.id, snapshot]),
      );

      const operationalItems = submittedItems.map((item) => {
        const ingredient = ingredients.get(item.insumoId);
        const finance = ingredientFinancials.get(item.insumoId);
        if (
          !ingredient?.exists ||
          ingredient.get("storeId") !== storeId ||
          !finance?.exists ||
          finance.get("storeId") !== storeId
        ) {
          throw new Error("Um insumo da ficha não pertence a esta loja.");
        }
        const unit = ingredient.get("unidade");
        if (typeof unit !== "string" || !units.includes(unit as UnidadeMedida)) {
          throw new Error(`A unidade do insumo ${ingredient.get("nome")} é inválida.`);
        }
        return {
          insumoId: item.insumoId,
          insumoNome: ingredient.get("nome"),
          quantidade: item.quantidade,
          unidade: unit,
          custoUnitario: finance.get("custoUnitario"),
        };
      });

      const canEditFinance = financeRoles.includes(profile.role);
      const previousFinance = financeSnapshot.data() ?? {};
      const productPrice = productSnapshot.get("preco");
      const precoVenda = canEditFinance
        ? requiredNumber(body.precoVenda, "Preço de venda", Number.MIN_VALUE)
        : typeof previousFinance.precoVenda === "number"
          ? previousFinance.precoVenda
          : requiredNumber(productPrice, "Preço do produto", Number.MIN_VALUE);
      const tipoMeta: TipoMetaPrecificacao = canEditFinance
        ? body.tipoMeta === "margem"
          ? "margem"
          : body.tipoMeta === "cmv"
            ? "cmv"
            : (() => {
                throw new Error("Tipo de meta inválido.");
              })()
        : previousFinance.tipoMeta === "margem"
          ? "margem"
          : "cmv";
      const percentualMeta = canEditFinance
        ? requiredNumber(body.percentualMeta, "Meta", 0)
        : typeof previousFinance.percentualMeta === "number"
          ? previousFinance.percentualMeta
          : 30;
      const rendimento = requiredNumber(
        body.rendimento,
        "Rendimento",
        Number.MIN_VALUE,
      );
      const costing = calculateRecipeCosting({
        itens: operationalItems.map((item) => ({
          insumoId: item.insumoId,
          quantidade: item.quantidade,
          custoUnitario: requiredNumber(
            item.custoUnitario,
            `Custo do insumo ${item.insumoNome}`,
            0,
          ),
        })),
        rendimento,
        precoVenda,
        tipoMeta,
        percentualMeta,
      });
      const now = new Date().toISOString();
      const storeItems = operationalItems.map((item) => ({
        insumoId: item.insumoId,
        insumoNome: item.insumoNome,
        quantidade: item.quantidade,
        unidade: item.unidade,
      }));
      transaction.set(recipeRef, {
        storeId,
        produtoId: productId,
        nome: productSnapshot.get("nome"),
        rendimento,
        itens: storeItems,
        atualizadoEm: now,
      });
      transaction.set(financeRef, {
        storeId,
        produtoId: productId,
        itens: costing.itens,
        custoTotal: costing.custoTotal,
        custoPorPorcao: costing.custoPorPorcao,
        precoVenda: costing.precoVenda,
        cmvAtual: costing.cmvAtual,
        margemAtual: costing.margemAtual,
        cmvAlvo: costing.cmvAlvo,
        margemAlvo: costing.margemAlvo,
        tipoMeta: costing.tipoMeta,
        percentualMeta: costing.percentualMeta,
        precoSugerido: costing.precoSugerido,
        atualizadoEm: now,
      });
      transaction.set(adminDb.collection("produtoCustos").doc(productId), {
        storeId,
        produtoId: productId,
        custoFicha: costing.custoPorPorcao,
        cmvAtual: costing.cmvAtual,
        margemAtual: costing.margemAtual,
        cmvAlvo: costing.cmvAlvo,
        margemAlvo: costing.margemAlvo,
        precoSugerido: costing.precoSugerido,
        atualizadoEm: now,
      });

      for (const ingredientId of ingredientIds) {
        const ingredient = ingredients.get(ingredientId);
        if (!ingredient?.exists || ingredient.get("storeId") !== storeId) continue;
        const linked = ingredient.get("fichasTecnicasIds");
        const linkedIds = Array.isArray(linked)
          ? linked.filter((id): id is string => typeof id === "string")
          : [];
        const shouldLink = submittedItems.some(
          (item) => item.insumoId === ingredientId,
        );
        const nextIds = shouldLink
          ? [...new Set([...linkedIds, productId])]
          : linkedIds.filter((id) => id !== productId);
        transaction.update(ingredient.ref, { fichasTecnicasIds: nextIds });
      }
    });

    return Response.json({ success: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
