import { applicationDefault, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const tenantCollections = [
  "insumos",
  "insumoFinancas",
  "produtos",
  "categorias",
  "fichasTecnicas",
  "fichaTecnicaFinancas",
  "produtoCustos",
  "compras",
  "invoices",
  "items",
  "signage",
];
const ingredientFinanceFields = [
  "quantidadeCompra",
  "precoCompra",
  "fatorCorrecao",
  "custoUnitario",
  "fornecedor",
];
const recipeFinanceFields = [
  "custoTotal",
  "tipoMeta",
  "percentualMeta",
  "precoVenda",
  "custoPorPorcao",
  "precoSugerido",
  "cmvAtual",
  "margemAtual",
  "cmvAlvo",
  "margemAlvo",
];
const publicProductCostFields = [
  "custoFicha",
  "cmvAtual",
  "cmvAlvo",
  "margemAtual",
  "margemAlvo",
  "precoSugerido",
];
const options = new Map();
const argumentsList = process.argv.slice(2);

for (let index = 0; index < argumentsList.length; index += 1) {
  const argument = argumentsList[index];
  if (argument === "--apply") {
    options.set("apply", true);
    continue;
  }
  if (argument === "--project" || argument === "--store-id") {
    const value = argumentsList[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Informe o valor após ${argument}.`);
    }
    options.set(argument.slice(2), value);
    index += 1;
    continue;
  }
  throw new Error(`Argumento não reconhecido: ${argument}`);
}

const projectId = options.get("project");
const storeId = options.get("store-id");
if (!projectId || !/^[A-Za-z0-9-]+$/.test(projectId)) {
  throw new Error("Informe um --project Firebase válido.");
}
if (!storeId || !/^[A-Za-z0-9_-]+$/.test(storeId)) {
  throw new Error("Informe um --store-id válido.");
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function removeFields(data, fields) {
  const result = { ...data };
  for (const field of fields) delete result[field];
  return result;
}

function getCostFields(data, fields) {
  return Object.fromEntries(
    fields
      .filter((field) => data[field] !== undefined)
      .map((field) => [field, data[field]]),
  );
}

function calculateSuggestion(cost, targetType, targetPercentage) {
  const rate = targetPercentage / 100;
  if (targetType === "margem") {
    if (rate < 0 || rate >= 1) throw new Error("A meta de margem está inválida.");
    return Math.round((cost / (1 - rate)) * 100) / 100;
  }
  if (rate <= 0 || rate > 1) throw new Error("A meta de CMV está inválida.");
  return Math.round((cost / rate) * 100) / 100;
}

async function migrate() {
  initializeApp({
    credential: applicationDefault(),
    projectId,
  });
  const db = getFirestore();
  const snapshots = await Promise.all(
    tenantCollections.map((name) => db.collection(name).get()),
  );
  const documentsByCollection = new Map(
    tenantCollections.map((name, index) => [
      name,
      new Map(snapshots[index].docs.map((document) => [document.id, document])),
    ]),
  );
  const conflicts = [];
  const writes = [];
  const counters = {
    storeIds: 0,
    ingredientFinances: 0,
    recipeFinances: 0,
    productCostRedactions: 0,
  };

  snapshots.forEach((snapshot, index) => {
    for (const document of snapshot.docs) {
      const currentStoreId = document.get("storeId");
      if (currentStoreId !== undefined && currentStoreId !== storeId) {
        conflicts.push(`${tenantCollections[index]}/${document.id}`);
      }
    }
  });
  if (conflicts.length > 0) {
    throw new Error(
      `Nenhum documento foi alterado: ${conflicts.length} documento(s) já pertencem a outra loja. Revise os IDs antes de continuar.`,
    );
  }

  const existingIngredientFinances = documentsByCollection.get("insumoFinancas");
  const existingRecipeFinances = documentsByCollection.get("fichaTecnicaFinancas");
  const existingProductCosts = documentsByCollection.get("produtoCustos");
  const productDocuments = documentsByCollection.get("produtos");
  const ingredientDocuments = documentsByCollection.get("insumos");
  const migratedProductCostIds = new Set();

  for (const ingredient of snapshots[tenantCollections.indexOf("insumos")].docs) {
    const data = ingredient.data();
    const legacyFinance = getCostFields(data, ingredientFinanceFields);
    const financeRef = db.collection("insumoFinancas").doc(ingredient.id);
    const financeExists = existingIngredientFinances.has(ingredient.id);
    const patch = {};
    if (data.storeId === undefined) {
      patch.storeId = storeId;
      counters.storeIds += 1;
    }
    for (const field of ingredientFinanceFields) {
      if (data[field] !== undefined) patch[field] = FieldValue.delete();
    }
    if (Object.keys(legacyFinance).length > 0) {
      if (financeExists) {
        throw new Error(
          `Migração interrompida sem gravações: insumos/${ingredient.id} contém dados financeiros antigos e insumoFinancas/${ingredient.id} já existe.`,
        );
      }
      const financeData = {
        ...legacyFinance,
        storeId,
        atualizadoEm: data.atualizadoEm ?? new Date().toISOString(),
      };
      writes.push({
        groupId: `insumo:${ingredient.id}`,
        type: "set",
        ref: financeRef,
        data: financeData,
      });
      counters.ingredientFinances += 1;
    }
    if (Object.keys(patch).length > 0) {
      writes.push({
        groupId: `insumo:${ingredient.id}`,
        type: "update",
        ref: ingredient.ref,
        data: patch,
      });
    }
  }

  for (const recipe of snapshots[tenantCollections.indexOf("fichasTecnicas")].docs) {
    const data = recipe.data();
    const existingFinancial = existingRecipeFinances.get(recipe.id);
    const legacyItems = Array.isArray(data.itens) ? data.itens : [];
    const financialItems = [];
    const operationalItems = legacyItems.map((item) => {
      if (!isRecord(item)) {
        throw new Error(`Ficha fichasTecnicas/${recipe.id} tem item inválido.`);
      }
      if (
        typeof item.insumoId !== "string" ||
        typeof item.quantidade !== "number" ||
        !Number.isFinite(item.quantidade) ||
        item.quantidade <= 0
      ) {
        throw new Error(`Ficha fichasTecnicas/${recipe.id} tem item inválido.`);
      }
      const oldCost = item.custoUnitario;
      let unitCost = oldCost;
      if (typeof unitCost !== "number" || !Number.isFinite(unitCost) || unitCost < 0) {
        const ingredientFinance = existingIngredientFinances.get(item.insumoId);
        const ingredientData = ingredientFinance?.data();
        const ingredientLegacy = ingredientDocuments.get(item.insumoId)?.data();
        unitCost =
          ingredientData?.custoUnitario ?? ingredientLegacy?.custoUnitario;
      }
      if (
        typeof unitCost !== "number" ||
        !Number.isFinite(unitCost) ||
        unitCost < 0
      ) {
        throw new Error(
          `Migração sem gravações: custo unitário ausente para o insumo ${item.insumoId}, ficha ${recipe.id}.`,
        );
      }
      const itemCost = unitCost * item.quantidade;
      financialItems.push({
        insumoId: item.insumoId,
        custoUnitario: unitCost,
        custoTotal:
          typeof item.custoTotal === "number" &&
          Number.isFinite(item.custoTotal) &&
          item.custoTotal >= 0
            ? item.custoTotal
            : itemCost,
      });
      return removeFields(item, ["custoUnitario", "custoTotal"]);
    });

    const legacyFinancial = getCostFields(data, recipeFinanceFields);
    const hasLegacyRecipeFinancials =
      Object.keys(legacyFinancial).length > 0 ||
      legacyItems.some(
        (item) =>
          isRecord(item) &&
          (item.custoUnitario !== undefined || item.custoTotal !== undefined),
      );
    if (existingFinancial && hasLegacyRecipeFinancials) {
      throw new Error(
        `Migração interrompida sem gravações: fichasTecnicas/${recipe.id} contém custos antigos e fichaTecnicaFinancas/${recipe.id} já existe.`,
      );
    }

    const shouldCreateFinance = !existingFinancial && legacyItems.length > 0;
    if (shouldCreateFinance) {
      const product = productDocuments.get(data.produtoId ?? recipe.id)?.data();
      const rendimento =
        typeof data.rendimento === "number" && data.rendimento > 0
          ? data.rendimento
          : 1;
      const custoTotal = financialItems.reduce(
        (total, item) => total + item.custoTotal,
        0,
      );
      const custoPorPorcao = custoTotal / rendimento;
      const precoVenda =
        typeof legacyFinancial.precoVenda === "number" &&
        legacyFinancial.precoVenda > 0
          ? legacyFinancial.precoVenda
          : product?.preco;
      if (typeof precoVenda !== "number" || !Number.isFinite(precoVenda) || precoVenda <= 0) {
        throw new Error(
          `Migração sem gravações: preço de venda ausente para o produto da ficha ${recipe.id}.`,
        );
      }
      const tipoMeta = legacyFinancial.tipoMeta === "margem" ? "margem" : "cmv";
      const percentualMeta =
        typeof legacyFinancial.percentualMeta === "number" &&
        Number.isFinite(legacyFinancial.percentualMeta)
          ? legacyFinancial.percentualMeta
          : 30;
      const cmvAlvo =
        tipoMeta === "cmv" ? percentualMeta / 100 : 1 - percentualMeta / 100;
      const precoSugerido = calculateSuggestion(
        custoPorPorcao,
        tipoMeta,
        percentualMeta,
      );
      const financeData = {
        ...legacyFinancial,
        storeId,
        produtoId: data.produtoId ?? recipe.id,
        itens: financialItems,
        custoTotal,
        custoPorPorcao,
        precoVenda,
        cmvAtual: custoPorPorcao / precoVenda,
        margemAtual: 1 - custoPorPorcao / precoVenda,
        cmvAlvo,
        margemAlvo: 1 - cmvAlvo,
        tipoMeta,
        percentualMeta,
        precoSugerido,
        atualizadoEm: data.atualizadoEm ?? new Date().toISOString(),
      };
      writes.push({
        groupId: `ficha:${recipe.id}`,
        type: "set",
        ref: db.collection("fichaTecnicaFinancas").doc(recipe.id),
        data: financeData,
      });
      writes.push({
        groupId: `ficha:${recipe.id}`,
        type: "set",
        ref: db.collection("produtoCustos").doc(data.produtoId ?? recipe.id),
        data: {
          storeId,
          produtoId: data.produtoId ?? recipe.id,
          custoFicha: custoPorPorcao,
          cmvAtual: custoPorPorcao / precoVenda,
          margemAtual: 1 - custoPorPorcao / precoVenda,
          cmvAlvo,
          margemAlvo: 1 - cmvAlvo,
          precoSugerido,
          atualizadoEm: data.atualizadoEm ?? new Date().toISOString(),
        },
      });
      migratedProductCostIds.add(data.produtoId ?? recipe.id);
      counters.recipeFinances += 1;
    }

    const patch = {};
    if (data.storeId === undefined) {
      patch.storeId = storeId;
      counters.storeIds += 1;
    }
    for (const field of recipeFinanceFields) {
      if (data[field] !== undefined) patch[field] = FieldValue.delete();
    }
    if (legacyItems.some((item) => isRecord(item) && (
      item.custoUnitario !== undefined || item.custoTotal !== undefined
    ))) {
      patch.itens = operationalItems;
    }
    if (Object.keys(patch).length > 0) {
      writes.push({
        groupId: `ficha:${recipe.id}`,
        type: "update",
        ref: recipe.ref,
        data: patch,
      });
    }
  }

  for (const product of snapshots[tenantCollections.indexOf("produtos")].docs) {
    const data = product.data();
    const patch = {};
    if (data.storeId === undefined) {
      patch.storeId = storeId;
      counters.storeIds += 1;
    }
    const oldCosts = getCostFields(data, publicProductCostFields);
    if (
      Object.keys(oldCosts).length > 0 &&
      !existingProductCosts.has(product.id) &&
      !migratedProductCostIds.has(product.id)
    ) {
      writes.push({
        groupId: `produto:${product.id}`,
        type: "set",
        ref: db.collection("produtoCustos").doc(product.id),
        data: {
          ...oldCosts,
          storeId,
          produtoId: product.id,
          atualizadoEm: data.atualizadoEm ?? new Date().toISOString(),
        },
      });
    }
    if (publicProductCostFields.some((field) => data[field] !== undefined)) {
      for (const field of publicProductCostFields) {
        if (data[field] !== undefined) patch[field] = FieldValue.delete();
      }
      counters.productCostRedactions += 1;
    }
    if (Object.keys(patch).length > 0) {
      writes.push({
        groupId: `produto:${product.id}`,
        type: "update",
        ref: product.ref,
        data: patch,
      });
    }
  }

  for (const name of tenantCollections) {
    if (name === "insumos" || name === "fichasTecnicas" || name === "produtos") {
      continue;
    }
    for (const document of snapshots[tenantCollections.indexOf(name)].docs) {
      if (document.get("storeId") !== undefined) continue;
      writes.push({
        groupId: `${name}:${document.id}`,
        type: "update",
        ref: document.ref,
        data: { storeId },
      });
      counters.storeIds += 1;
    }
  }

  console.log(`Projeto: ${projectId}`);
  console.log(`Loja: ${storeId}`);
  console.log(`Documentos que recebem storeId: ${counters.storeIds}`);
  console.log(`Custos de insumos separados: ${counters.ingredientFinances}`);
  console.log(`Custos de fichas migrados/calculados: ${counters.recipeFinances}`);
  console.log(`Produtos com custos públicos removidos: ${counters.productCostRedactions}`);
  console.log(`Operações planejadas: ${writes.length}`);
  console.log(
    options.get("apply")
      ? "Modo: aplicar migração"
      : "Modo: simulação (use --apply para gravar)",
  );

  if (!options.get("apply") || writes.length === 0) return;
  const groupedWrites = new Map();
  for (const operation of writes) {
    const group = groupedWrites.get(operation.groupId) ?? [];
    group.push(operation);
    groupedWrites.set(operation.groupId, group);
  }
  let batch = db.batch();
  let batchSize = 0;
  let completed = 0;
  for (const operations of groupedWrites.values()) {
    if (batchSize + operations.length > 450) {
      await batch.commit();
      completed += batchSize;
      console.log(`Concluídas ${completed} de ${writes.length} operações.`);
      batch = db.batch();
      batchSize = 0;
    }
    for (const operation of operations) {
      if (operation.type === "set") {
        batch.set(operation.ref, operation.data);
      } else {
        batch.update(operation.ref, operation.data);
      }
    }
    batchSize += operations.length;
  }
  if (batchSize > 0) {
    await batch.commit();
    completed += batchSize;
    console.log(`Concluídas ${completed} de ${writes.length} operações.`);
  }
}

migrate().catch((error) => {
  console.error(
    `Migração interrompida: ${error instanceof Error ? error.message : "erro inesperado"}`,
  );
  process.exitCode = 1;
});
