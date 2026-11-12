import { NextRequest } from "next/server";
import {
  apiErrorResponse,
  authenticateAdminRequest,
  authorizeStoreRole,
} from "@/lib/auth/server-profile";
import { adminDb } from "@/lib/firebase/admin";
import { calculateRecipeCosting } from "@/lib/utils/recipe-costing";
import type { ClassificacaoCompraItem, ItemCompra, UnidadeMedida, UserRole } from "@/types";

export const runtime = "nodejs";

const purchaserRoles = [
  "super_admin",
  "owner",
  "manager",
  "purchasing",
] satisfies UserRole[];
const units: UnidadeMedida[] = [
  "kg",
  "g",
  "L",
  "ml",
  "unidade",
  "pacote",
  "caixa",
];
const unitFactors: Record<UnidadeMedida, { dimension: string; factor: number }> = {
  kg: { dimension: "mass", factor: 1000 },
  g: { dimension: "mass", factor: 1 },
  L: { dimension: "volume", factor: 1000 },
  ml: { dimension: "volume", factor: 1 },
  unidade: { dimension: "count", factor: 1 },
  pacote: { dimension: "package", factor: 1 },
  caixa: { dimension: "box", factor: 1 },
};

interface ProductionGroup {
  insumoId: string;
  quantity: number;
  total: number;
}

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

function optionalText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string" || value.trim().length > maximum) {
    throw new Error(`${label} inválido.`);
  }
  return value.trim();
}

function finiteNonNegative(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} inválido.`);
  }
  return value;
}

function convertQuantity(
  quantity: number,
  fromUnit: UnidadeMedida,
  toUnit: UnidadeMedida,
): number {
  const from = unitFactors[fromUnit];
  const to = unitFactors[toUnit];
  if (from.dimension !== to.dimension) {
    throw new Error(
      `As unidades ${fromUnit} e ${toUnit} não são compatíveis. Ajuste a unidade da nota.`,
    );
  }
  return (quantity * from.factor) / to.factor;
}

function parseInvoiceItems(value: unknown): {
  items: ItemCompra[];
  groups: ProductionGroup[];
} {
  if (!Array.isArray(value) || value.length === 0 || value.length > 300) {
    throw new Error("A nota deve conter de 1 a 300 itens.");
  }
  const groups = new Map<string, ProductionGroup>();
  const items = value.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`O item ${index + 1} é inválido.`);
    const descricao = requiredText(entry.descricao, `Descrição do item ${index + 1}`, 150);
    if (
      entry.classificacao !== "insumo_producao" &&
      entry.classificacao !== "compra_geral"
    ) {
      throw new Error(`Selecione uma classificação para "${descricao}".`);
    }
    const valorTotal = finiteNonNegative(entry.valorTotal, `Valor de ${descricao}`);
    const valorUnitario =
      entry.valorUnitario === null
        ? null
        : finiteNonNegative(entry.valorUnitario, `Valor unitário de ${descricao}`);
    const quantidade: number | null =
      entry.quantidade === null || entry.quantidade === undefined
        ? null
        : finiteNonNegative(entry.quantidade, `Quantidade de ${descricao}`);
    const rawUnit = entry.unidade ?? "";
    if (
      typeof rawUnit !== "string" ||
      (rawUnit !== "" && !units.includes(rawUnit as UnidadeMedida))
    ) {
      throw new Error(`Unidade de ${descricao} inválida.`);
    }
    const unidade = rawUnit as ItemCompra["unidade"];
    if (quantidade !== null && quantidade <= 0) {
      throw new Error(`Quantidade de ${descricao} deve ser maior que zero.`);
    }
    let insumoId = "";
    if (entry.classificacao === "insumo_producao") {
      insumoId = requiredText(entry.insumoId, `Insumo de ${descricao}`, 150);
      if (
        quantidade === null ||
        quantidade <= 0 ||
        unidade === ""
      ) {
        throw new Error(`Informe quantidade e unidade válidas para "${descricao}".`);
      }
      const current = groups.get(insumoId) ?? {
        insumoId,
        quantity: 0,
        total: 0,
      };
      current.quantity += quantidade;
      current.total += valorTotal;
      groups.set(insumoId, current);
    }
    return {
      descricao,
      quantidade,
      unidade,
      valorUnitario,
      valorTotal,
      classificacao: entry.classificacao as ClassificacaoCompraItem,
      insumoId,
    };
  });
  if (groups.size > 150) {
    throw new Error(
      "A nota contém mais de 150 insumos de produção distintos; divida a confirmação.",
    );
  }
  return { items, groups: [...groups.values()] };
}

export async function POST(request: NextRequest) {
  try {
    const profile = await authenticateAdminRequest(request);
    const body: unknown = await request.json();
    if (!isRecord(body) || !isRecord(body.confirmacao)) {
      throw new Error("Dados da compra inválidos.");
    }
    const storeId = requiredText(body.storeId, "Loja", 100);
    authorizeStoreRole(profile, storeId, purchaserRoles);
    const confirmation = body.confirmacao;
    const fornecedor = requiredText(confirmation.fornecedor, "Fornecedor", 150);
    const numeroNota = optionalText(confirmation.numeroNota, "Número da nota", 100);
    const dataEmissao = optionalText(confirmation.dataEmissao, "Data da nota", 20);
    if (dataEmissao && !/^\d{4}-\d{2}-\d{2}$/.test(dataEmissao)) {
      throw new Error("Data de emissão inválida.");
    }
    const nomeArquivo = requiredText(confirmation.nomeArquivo, "Nome do arquivo", 250);
    const { items, groups } = parseInvoiceItems(confirmation.itens);
    const totalCompra = items.reduce((total, item) => total + (item.valorTotal ?? 0), 0);
    const purchaseRef = adminDb.collection("compras").doc();
    const invoiceRef = adminDb.collection("invoices").doc(purchaseRef.id);
    const recipesQuery = adminDb
      .collection("fichasTecnicas")
      .where("storeId", "==", storeId);

    await adminDb.runTransaction(async (transaction) => {
      const recipeSnapshots =
        groups.length > 0 ? await transaction.get(recipesQuery) : null;
      const groupById = new Map(groups.map((group) => [group.insumoId, group]));
      const affectedRecipes = recipeSnapshots
        ? recipeSnapshots.docs.filter((snapshot) => {
            const recipeItems: unknown = snapshot.get("itens");
            return (
              Array.isArray(recipeItems) &&
              recipeItems.some(
                (item) =>
                  isRecord(item) &&
                  typeof item.insumoId === "string" &&
                  groupById.has(item.insumoId),
              )
            );
          })
        : [];
      if (affectedRecipes.length > 90) {
        throw new Error(
          "Muitos produtos dependem destes insumos para uma única atualização. Divida a nota em compras menores.",
        );
      }

      const ingredientIds = groups.map((group) => group.insumoId);
      const recipeIds = affectedRecipes.map((snapshot) => snapshot.id);
      const refs = {
        ingredients: ingredientIds.map((id) =>
          adminDb.collection("insumos").doc(id),
        ),
        ingredientFinance: ingredientIds.map((id) =>
          adminDb.collection("insumoFinancas").doc(id),
        ),
        recipeFinance: recipeIds.map((id) =>
          adminDb.collection("fichaTecnicaFinancas").doc(id),
        ),
        products: affectedRecipes.map((recipe) =>
          adminDb.collection("produtos").doc(recipe.id),
        ),
      };
      const [
        ingredientSnapshots,
        ingredientFinanceSnapshots,
        recipeFinanceSnapshots,
        productSnapshots,
      ] = await Promise.all([
        Promise.all(refs.ingredients.map((ref) => transaction.get(ref))),
        Promise.all(refs.ingredientFinance.map((ref) => transaction.get(ref))),
        Promise.all(refs.recipeFinance.map((ref) => transaction.get(ref))),
        Promise.all(refs.products.map((ref) => transaction.get(ref))),
      ]);
      const ingredientById = new Map(
        ingredientSnapshots.map((snapshot) => [snapshot.id, snapshot]),
      );
      const financeByIngredientId = new Map(
        ingredientFinanceSnapshots.map((snapshot) => [
          snapshot.id,
          snapshot,
        ]),
      );
      const adjustedIngredients = new Map<
        string,
        { quantity: number; total: number; unitCost: number; supplier: string }
      >();
      for (const group of groups) {
        const ingredient = ingredientById.get(group.insumoId);
        const finance = financeByIngredientId.get(group.insumoId);
        if (
          !ingredient?.exists ||
          ingredient.get("storeId") !== storeId ||
          !finance?.exists ||
          finance.get("storeId") !== storeId
        ) {
          throw new Error("Um insumo vinculado não pertence a esta loja.");
        }
        const unit = ingredient.get("unidade");
        if (typeof unit !== "string" || !units.includes(unit as UnidadeMedida)) {
          throw new Error(`A unidade do insumo ${ingredient.get("nome")} é inválida.`);
        }
        const factor = finance.get("fatorCorrecao");
        const currentStock = ingredient.get("quantidadeEstoque") ?? 0;
        if (typeof factor !== "number" || !Number.isFinite(factor) || factor < 1) {
          throw new Error(`O fator de correção de ${ingredient.get("nome")} está inválido.`);
        }
        if (
          typeof currentStock !== "number" ||
          !Number.isFinite(currentStock) ||
          currentStock < 0
        ) {
          throw new Error(`O saldo de estoque de ${ingredient.get("nome")} está inválido.`);
        }
        const matchingItems = items.filter(
          (item) =>
            item.classificacao === "insumo_producao" &&
            item.insumoId === group.insumoId,
        );
        const normalizedQuantity = matchingItems.reduce(
          (total, item) =>
            total +
            convertQuantity(
              item.quantidade as number,
              item.unidade as UnidadeMedida,
              unit as UnidadeMedida,
            ),
          0,
        );
        if (!Number.isFinite(normalizedQuantity) || normalizedQuantity <= 0) {
          throw new Error(`A quantidade de ${ingredient.get("nome")} é inválida.`);
        }
        adjustedIngredients.set(group.insumoId, {
          quantity: normalizedQuantity,
          total: group.total,
          unitCost: (group.total / normalizedQuantity) * factor,
          supplier: fornecedor,
        });
      }

      const recipeUpdates = affectedRecipes.map((recipe, index) => {
        const recipeItems: unknown = recipe.get("itens");
        const recipeFinance = recipeFinanceSnapshots[index];
        const product = productSnapshots[index];
        if (
          !Array.isArray(recipeItems) ||
          !recipeFinance.exists ||
          recipeFinance.get("storeId") !== storeId ||
          !product.exists ||
          product.get("storeId") !== storeId
        ) {
          throw new Error(
            `Os dados financeiros do produto ${recipe.id} ainda não foram migrados.`,
          );
        }
        const financialItems = new Map<string, number>();
        const savedFinancialItems: unknown = recipeFinance.get("itens");
        if (Array.isArray(savedFinancialItems)) {
          for (const item of savedFinancialItems) {
            if (
              isRecord(item) &&
              typeof item.insumoId === "string" &&
              typeof item.custoUnitario === "number"
            ) {
              financialItems.set(item.insumoId, item.custoUnitario);
            }
          }
        }
        const costingItems = recipeItems.map((item) => {
          if (
            !isRecord(item) ||
            typeof item.insumoId !== "string" ||
            typeof item.quantidade !== "number"
          ) {
            throw new Error(`A ficha do produto ${recipe.id} está inválida.`);
          }
          const unitCost =
            adjustedIngredients.get(item.insumoId)?.unitCost ??
            financialItems.get(item.insumoId);
          if (unitCost === undefined) {
            throw new Error(`Custo do insumo ${item.insumoId} não encontrado.`);
          }
          return {
            insumoId: item.insumoId,
            quantidade: item.quantidade,
            custoUnitario: unitCost,
          };
        });
        const targetType =
          recipeFinance.get("tipoMeta") === "margem" ? "margem" : "cmv";
        const targetPercentage = recipeFinance.get("percentualMeta");
        const salePrice = recipeFinance.get("precoVenda");
        const costing = calculateRecipeCosting({
          itens: costingItems,
          rendimento: recipe.get("rendimento"),
          precoVenda:
            typeof salePrice === "number" && salePrice > 0
              ? salePrice
              : (product.get("preco") as number),
          tipoMeta: targetType,
          percentualMeta:
            typeof targetPercentage === "number" ? targetPercentage : 30,
        });
        const updatedFinancialItems = costing.itens.map((item) => ({
          ...item,
          custoUnitario: costingItems.find(
            (costingItem) => costingItem.insumoId === item.insumoId,
          )?.custoUnitario,
        }));
        return { recipeId: recipe.id, costing, updatedFinancialItems };
      });

      const now = new Date().toISOString();
      for (const [index, group] of groups.entries()) {
        const ingredient = ingredientSnapshots[index];
        const financial = ingredientFinanceSnapshots[index];
        const adjustment = adjustedIngredients.get(group.insumoId);
        if (!adjustment) continue;
        transaction.update(ingredient.ref, {
          quantidadeEstoque:
            (ingredient.get("quantidadeEstoque") as number) + adjustment.quantity,
          atualizadoEm: now,
        });
        transaction.set(financial.ref, {
          ...financial.data(),
          storeId,
          quantidadeCompra: adjustment.quantity,
          precoCompra: adjustment.total,
          custoUnitario: adjustment.unitCost,
          fornecedor: adjustment.supplier,
          atualizadoEm: now,
        });
      }
      for (const update of recipeUpdates) {
        transaction.set(
          adminDb.collection("fichaTecnicaFinancas").doc(update.recipeId),
          {
            ...update.costing,
            itens: update.updatedFinancialItems,
            storeId,
            produtoId: update.recipeId,
            atualizadoEm: now,
          },
        );
        transaction.set(
          adminDb.collection("produtoCustos").doc(update.recipeId),
          {
            storeId,
            produtoId: update.recipeId,
            custoFicha: update.costing.custoPorPorcao,
            cmvAtual: update.costing.cmvAtual,
            margemAtual: update.costing.margemAtual,
            cmvAlvo: update.costing.cmvAlvo,
            margemAlvo: update.costing.margemAlvo,
            precoSugerido: update.costing.precoSugerido,
            atualizadoEm: now,
          },
        );
      }
      transaction.create(purchaseRef, {
        storeId,
        status: "confirmada",
        nomeArquivo,
        fornecedor,
        numeroNota,
        dataEmissao,
        itens: items,
        totalCompra,
        criadaEm: now,
        confirmadaEm: now,
        usuarioId: profile.uid,
      });
      transaction.create(invoiceRef, {
        storeId,
        fornecedor,
        numeroNota,
        dataEmissao,
        itens: items,
        totalCompra,
        nomeArquivo,
        criadaEm: now,
        usuarioId: profile.uid,
        status: "confirmada",
      });
    });

    return Response.json({ id: purchaseRef.id });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
