import {
  collection,
  deleteField,
  doc,
  getDocs,
  onSnapshot,
  runTransaction,
  query,
  where,
  writeBatch,
  type Unsubscribe,
} from "firebase/firestore";
import { getFirebaseServices } from "@/lib/firebase";
import {
  calcularPrecoParaMargem,
  calcularPrecoSugerido,
} from "@/lib/utils/cmv";
import type {
  ClassificacaoCompraItem,
  Compra,
  FichaTecnica,
  Insumo,
  ItemCompra,
  ItemCardapioImportado,
  NotaImportada,
  Produto,
  UnidadeMedida,
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

interface ProducaoAgrupada {
  insumoId: string;
  quantidade: number;
  valorTotal: number;
}

const unitFactors: Partial<
  Record<UnidadeMedida, { dimension: string; factor: number }>
> = {
  kg: { dimension: "mass", factor: 1000 },
  g: { dimension: "mass", factor: 1 },
  L: { dimension: "volume", factor: 1000 },
  ml: { dimension: "volume", factor: 1 },
  unidade: { dimension: "count", factor: 1 },
  pacote: { dimension: "package", factor: 1 },
  caixa: { dimension: "box", factor: 1 },
};

function convertQuantity(
  quantity: number,
  fromUnit: UnidadeMedida,
  toUnit: UnidadeMedida,
): number {
  const from = unitFactors[fromUnit];
  const to = unitFactors[toUnit];
  if (!from || !to || from.dimension !== to.dimension) {
    throw new Error(
      `As unidades ${fromUnit} e ${toUnit} não são compatíveis. Ajuste a unidade da nota.`,
    );
  }
  return (quantity * from.factor) / to.factor;
}

function validateInvoiceItems(items: ItemCompra[]): ProducaoAgrupada[] {
  if (items.length === 0) {
    throw new Error("A nota precisa ter ao menos um item antes da confirmação.");
  }

  const production = new Map<string, ProducaoAgrupada>();
  for (const [index, item] of items.entries()) {
    if (!item.descricao.trim()) {
      throw new Error(`Preencha a descrição do item ${index + 1}.`);
    }
    if (
      item.classificacao !== "insumo_producao" &&
      item.classificacao !== "compra_geral"
    ) {
      throw new Error(`Selecione uma classificação para "${item.descricao}".`);
    }
    if (
      item.valorTotal === null ||
      !Number.isFinite(item.valorTotal) ||
      item.valorTotal < 0
    ) {
      throw new Error(`Informe um valor total válido para "${item.descricao}".`);
    }
    if (item.classificacao === "compra_geral") continue;
    if (!item.insumoId) {
      throw new Error(`Vincule "${item.descricao}" a um insumo do estoque.`);
    }
    if (
      item.quantidade === null ||
      !Number.isFinite(item.quantidade) ||
      item.quantidade <= 0 ||
      !item.unidade
    ) {
      throw new Error(`Informe quantidade e unidade para "${item.descricao}".`);
    }

    const current = production.get(item.insumoId) ?? {
      insumoId: item.insumoId,
      quantidade: 0,
      valorTotal: 0,
    };
    current.quantidade += item.quantidade;
    current.valorTotal += item.valorTotal;
    production.set(item.insumoId, current);
  }
  return [...production.values()];
}

export async function importarItensCardapio(
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
  usuarioId: string,
  onChange: (compras: Compra[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const { db } = getFirebaseServices();
  return onSnapshot(
    query(collection(db, "compras"), where("usuarioId", "==", usuarioId)),
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
  usuarioId: string,
  confirmacao: NotaImportacaoInput,
): Promise<string> {
  const groupedProduction = validateInvoiceItems(confirmacao.itens);
  const { db } = getFirebaseServices();
  const purchaseRef = doc(collection(db, "compras"));
  const invoiceRef = doc(db, "invoices", purchaseRef.id);
  const ingredientRefs = groupedProduction.map(({ insumoId }) =>
    doc(db, "insumos", insumoId),
  );
  const productionIds = new Set(
    groupedProduction.map((group) => group.insumoId),
  );
  const recipeRefs =
    productionIds.size > 0
      ? (await getDocs(collection(db, "fichasTecnicas"))).docs
          .filter((snapshot) => {
            const recipeItems = snapshot.data().itens;
            return (
              Array.isArray(recipeItems) &&
              recipeItems.some(
                (item: unknown) =>
                  typeof item === "object" &&
                  item !== null &&
                  "insumoId" in item &&
                  typeof item.insumoId === "string" &&
                  productionIds.has(item.insumoId),
              )
            );
          })
          .map((snapshot) => doc(db, "fichasTecnicas", snapshot.id))
      : [];

  await runTransaction(db, async (transaction) => {
    const [existingPurchase, existingInvoice, ingredientSnapshots, recipeSnapshots] =
      await Promise.all([
        transaction.get(purchaseRef),
        transaction.get(invoiceRef),
        Promise.all(ingredientRefs.map((ref) => transaction.get(ref))),
        Promise.all(recipeRefs.map((ref) => transaction.get(ref))),
      ]);
    if (existingPurchase.exists() || existingInvoice.exists()) {
      throw new Error("O identificador da nota já foi utilizado. Tente novamente.");
    }

    const ingredientsById = new Map<string, Insumo>();
    for (const snapshot of ingredientSnapshots) {
      if (!snapshot.exists()) {
        throw new Error("Um insumo vinculado não existe mais no estoque.");
      }
      ingredientsById.set(snapshot.id, {
        id: snapshot.id,
        ...snapshot.data(),
      } as Insumo);
    }

    const productionById = new Map(
      groupedProduction.map((group) => [group.insumoId, group]),
    );
    const adjustedIngredients = new Map<string, Insumo>();
    for (const group of groupedProduction) {
      const ingredient = ingredientsById.get(group.insumoId);
      if (!ingredient) throw new Error("Insumo de produção não encontrado.");
      const matchingLines = confirmacao.itens.filter(
        (item) =>
          item.classificacao === "insumo_producao" &&
          item.insumoId === group.insumoId,
      );
      const normalizedQuantity = matchingLines.reduce((total, item) => {
        if (!item.unidade || item.quantidade === null) return total;
        return (
          total + convertQuantity(item.quantidade, item.unidade, ingredient.unidade)
        );
      }, 0);
      if (!Number.isFinite(normalizedQuantity) || normalizedQuantity <= 0) {
        throw new Error(
          `Não foi possível converter a quantidade de ${ingredient.nome} para ${ingredient.unidade}.`,
        );
      }
      const correctionFactor = ingredient.fatorCorrecao;
      if (!Number.isFinite(correctionFactor) || correctionFactor < 1) {
        throw new Error(`O fator de correção de ${ingredient.nome} está inválido.`);
      }
      const currentStock = ingredient.quantidadeEstoque ?? 0;
      if (!Number.isFinite(currentStock) || currentStock < 0) {
        throw new Error(`O saldo de estoque de ${ingredient.nome} está inválido.`);
      }

      adjustedIngredients.set(group.insumoId, {
        ...ingredient,
        precoCompra: group.valorTotal,
        quantidadeCompra: normalizedQuantity,
        custoUnitario:
          (group.valorTotal / normalizedQuantity) * correctionFactor,
        quantidadeEstoque: currentStock + normalizedQuantity,
        atualizadoEm: new Date().toISOString(),
      });
    }

    const affectedRecipes = recipeSnapshots
      .filter((snapshot) => snapshot.exists())
      .map((snapshot) => ({
        ficha: { id: snapshot.id, ...snapshot.data() } as FichaTecnica,
      }))
      .filter((entry) =>
        entry.ficha.itens?.some((item) => productionById.has(item.insumoId)),
      );
    if (affectedRecipes.length > 100) {
      throw new Error(
        "Muitos produtos dependem destes insumos para uma única atualização. Divida a nota em compras menores.",
      );
    }
    const productsToUpdate = affectedRecipes.map(({ ficha }) => ({
      ficha,
      ref: doc(db, "produtos", ficha.produtoId || ficha.id),
      costRef: doc(db, "produtoCustos", ficha.produtoId || ficha.id),
    }));
    const productSnapshots = await Promise.all(
      productsToUpdate.map(({ ref }) => transaction.get(ref)),
    );

    const now = new Date().toISOString();
    const updatedRecipes = affectedRecipes.map(({ ficha }) => {
      const items = ficha.itens.map((item) => {
        const ingredient = adjustedIngredients.get(item.insumoId);
        if (!ingredient) return item;
        return {
          ...item,
          insumoNome: ingredient.nome,
          custoUnitario: ingredient.custoUnitario,
          custoTotal: ingredient.custoUnitario * item.quantidade,
        };
      });
      const custoTotal = items.reduce((total, item) => total + item.custoTotal, 0);
      const rendimento =
        Number.isFinite(ficha.rendimento) && ficha.rendimento > 0
          ? ficha.rendimento
          : 1;
      const custoPorPorcao = custoTotal / rendimento;
      const tipoMeta = ficha.tipoMeta === "margem" ? "margem" : "cmv";
      const percentualMeta = Number.isFinite(ficha.percentualMeta)
        ? ficha.percentualMeta
        : 30;
      const precoSugerido =
        tipoMeta === "cmv"
          ? calcularPrecoSugerido(custoPorPorcao, percentualMeta / 100)
          : calcularPrecoParaMargem(custoPorPorcao, percentualMeta / 100);
      const updatedFicha: FichaTecnica = {
        ...ficha,
        itens: items,
        custoTotal,
        custoPorPorcao,
        precoSugerido,
        atualizadoEm: now,
      };
      return { ficha: updatedFicha, custoPorPorcao, precoSugerido };
    });

    const totalCompra = confirmacao.itens.reduce(
      (total, item) => total + (item.valorTotal ?? 0),
      0,
    );
    for (const [index, { ficha, custoPorPorcao, precoSugerido }] of updatedRecipes.entries()) {
      const productSnapshot = productSnapshots[index];
      if (!productSnapshot.exists()) {
        throw new Error(`O produto da ficha "${ficha.nome}" não foi encontrado.`);
      }
      const product = { id: productSnapshot.id, ...productSnapshot.data() } as Produto;
      const price = Number.isFinite(product.preco) ? product.preco : 0;
      const cmvAtual = price > 0 ? custoPorPorcao / price : 0;
      const margemAtual = price > 0 ? 1 - cmvAtual : 0;
      const cmvAlvo =
        ficha.tipoMeta === "cmv"
          ? ficha.percentualMeta / 100
          : 1 - ficha.percentualMeta / 100;
      const productCost = {
        id: product.id,
        produtoId: product.id,
        custoFicha: custoPorPorcao,
        cmvAtual,
        margemAtual,
        cmvAlvo,
        margemAlvo: 1 - cmvAlvo,
        precoSugerido,
        atualizadoEm: now,
      };

      transaction.set(doc(db, "fichasTecnicas", ficha.id), ficha);
      transaction.set(productsToUpdate[index].costRef, productCost);
      transaction.update(productsToUpdate[index].ref, {
        custoFicha: deleteField(),
        cmvAtual: deleteField(),
        margemAtual: deleteField(),
        cmvAlvo: deleteField(),
        margemAlvo: deleteField(),
        precoSugerido: deleteField(),
        atualizadoEm: now,
      });
    }

    for (const ingredient of adjustedIngredients.values()) {
      transaction.update(doc(db, "insumos", ingredient.id), {
        precoCompra: ingredient.precoCompra,
        quantidadeCompra: ingredient.quantidadeCompra,
        custoUnitario: ingredient.custoUnitario,
        quantidadeEstoque: ingredient.quantidadeEstoque,
        atualizadoEm: ingredient.atualizadoEm,
      });
    }

    const invoice: Omit<NotaImportada, "id"> = {
      fornecedor: confirmacao.fornecedor.trim(),
      numeroNota: confirmacao.numeroNota.trim(),
      dataEmissao: confirmacao.dataEmissao,
      itens: confirmacao.itens,
      totalCompra,
      nomeArquivo: confirmacao.nomeArquivo,
      criadaEm: now,
      usuarioId,
    };
    transaction.set(invoiceRef, { ...invoice, status: "confirmada" });
    transaction.set(purchaseRef, {
      status: "confirmada",
      nomeArquivo: confirmacao.nomeArquivo,
      fornecedor: confirmacao.fornecedor.trim(),
      numeroNota: confirmacao.numeroNota.trim(),
      dataEmissao: confirmacao.dataEmissao,
      itens: confirmacao.itens,
      totalCompra,
      criadaEm: now,
      confirmadaEm: now,
      usuarioId,
    } satisfies Omit<Compra, "id">);
  });

  return purchaseRef.id;
}

export function isClassificacaoCompra(
  value: string,
): value is ClassificacaoCompraItem {
  return value === "insumo_producao" || value === "compra_geral";
}
