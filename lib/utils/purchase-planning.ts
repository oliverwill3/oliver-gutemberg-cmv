import type {
  FichaTecnica,
  Insumo,
  Produto,
  PurchaseListItem,
  VendaSemanalItem,
  VendasSemanais,
} from "@/types";

export interface ItemReposicao {
  insumoId: string;
  nome: string;
  quantidade: number;
  unidade: Insumo["unidade"];
  categoria: string;
  observacao: string;
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function parseCsvRows(content: string): string[][] {
  const firstLine = content.split(/\r?\n/, 1)[0] ?? "";
  const delimiters = [",", ";", "\t"];
  let delimiter = ",";
  let highestCount = -1;

  for (const candidate of delimiters) {
    let count = 0;
    let quoted = false;
    for (let index = 0; index < firstLine.length; index += 1) {
      if (firstLine[index] === '"') {
        if (quoted && firstLine[index + 1] === '"') index += 1;
        else quoted = !quoted;
      } else if (!quoted && firstLine[index] === candidate) {
        count += 1;
      }
    }
    if (count > highestCount) {
      highestCount = count;
      delimiter = candidate;
    }
  }

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const source = content.replace(/^\uFEFF/, "");

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      if (quoted && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && character === delimiter) {
      row.push(cell.trim());
      cell = "";
    } else if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (quoted) throw new Error("O CSV contém aspas sem fechamento.");
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function parseQuantity(value: string, lineNumber: number): number {
  const normalized = value.trim().replace(/\s/g, "");
  const decimalValue =
    normalized.includes(",") && normalized.includes(".")
      ? normalized.lastIndexOf(",") > normalized.lastIndexOf(".")
        ? normalized.replace(/\./g, "").replace(",", ".")
        : normalized.replace(/,/g, "")
      : normalized.replace(",", ".");
  const quantity = Number(decimalValue);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error(`Quantidade inválida na linha ${lineNumber}: "${value}".`);
  }
  return quantity;
}

export function parseWeeklySalesCsv(
  content: string,
  produtos: Produto[],
): VendaSemanalItem[] {
  if (content.length > 5_000_000) {
    throw new Error("O CSV deve ter no máximo 5 MB.");
  }
  const rows = parseCsvRows(content);
  if (rows.length < 2) {
    throw new Error("O CSV precisa ter cabeçalho e ao menos uma venda.");
  }

  const headers = rows[0].map(normalize);
  const productColumn = headers.findIndex((header) =>
    ["produto", "nomeproduto", "product", "productname"].includes(header),
  );
  const quantityColumn = headers.findIndex((header) =>
    [
      "quantidade",
      "qtd",
      "unidadesvendidas",
      "quantidadevendida",
      "qty",
      "soldquantity",
    ].includes(header),
  );
  if (productColumn < 0 || quantityColumn < 0) {
    throw new Error(
      'O CSV precisa ter as colunas "produto" e "quantidade" (ou equivalentes).',
    );
  }

  const productsByName = new Map<string, Produto>();
  const ambiguousNames = new Set<string>();
  for (const product of produtos) {
    const key = normalize(product.nome);
    if (productsByName.has(key)) ambiguousNames.add(key);
    else productsByName.set(key, product);
  }
  for (const key of ambiguousNames) productsByName.delete(key);

  const totals = new Map<string, VendaSemanalItem>();
  const unmatched = new Set<string>();
  for (const [index, row] of rows.slice(1).entries()) {
    const lineNumber = index + 2;
    const name = row[productColumn]?.trim() ?? "";
    const rawQuantity = row[quantityColumn]?.trim() ?? "";
    if (!name && !rawQuantity) continue;
    if (!name) throw new Error(`Produto não informado na linha ${lineNumber}.`);
    const productKey = normalize(name);
    if (ambiguousNames.has(productKey)) {
      throw new Error(
        `O produto "${name}" tem nome repetido no cardápio. Renomeie os produtos para importar as vendas sem ambiguidade.`,
      );
    }
    const product = productsByName.get(productKey);
    if (!product) {
      unmatched.add(name);
      continue;
    }
    const quantity = parseQuantity(rawQuantity, lineNumber);
    const existing = totals.get(product.id);
    totals.set(product.id, {
      produtoId: product.id,
      produtoNome: product.nome,
      unidadesVendidas: (existing?.unidadesVendidas ?? 0) + quantity,
    });
  }

  if (unmatched.size > 0) {
    throw new Error(
      `Produtos do CSV não encontrados no cardápio: ${[...unmatched].join(", ")}.`,
    );
  }
  if (totals.size === 0) throw new Error("Nenhuma venda válida foi encontrada.");
  if (totals.size > 300) {
    throw new Error("Importe no máximo 300 produtos por semana.");
  }
  return [...totals.values()];
}

export function calcularItensReposicao({
  insumos,
  fichas,
  vendas,
  itensExistentes,
}: {
  insumos: Insumo[];
  fichas: FichaTecnica[];
  vendas: VendasSemanais[];
  itensExistentes: PurchaseListItem[];
}): ItemReposicao[] {
  const existingIngredientIds = new Set(
    itensExistentes
      .filter(
        (item) =>
          item.status !== "rejected" && item.status !== "purchased",
      )
      .map((item) => item.insumoId)
      .filter(Boolean),
  );
  const ingredientById = new Map(insumos.map((item) => [item.id, item]));
  const recipeByProductId = new Map(fichas.map((item) => [item.produtoId, item]));
  const weeklyReports = vendas.slice(0, 4);
  const totalUsage = new Map<string, number>();

  for (const report of weeklyReports) {
    const usageThisWeek = new Map<string, number>();
    for (const sale of report.itens) {
      if (
        !Number.isFinite(sale.unidadesVendidas) ||
        sale.unidadesVendidas <= 0
      ) {
        continue;
      }
      const recipe = recipeByProductId.get(sale.produtoId);
      if (!recipe || !Number.isFinite(recipe.rendimento) || recipe.rendimento <= 0) {
        continue;
      }
      for (const recipeItem of recipe.itens) {
        const ingredient = ingredientById.get(recipeItem.insumoId);
        if (!ingredient || ingredient.unidade !== recipeItem.unidade) continue;
        usageThisWeek.set(
          ingredient.id,
          (usageThisWeek.get(ingredient.id) ?? 0) +
            (recipeItem.quantidade * sale.unidadesVendidas) / recipe.rendimento,
        );
      }
    }
    for (const [ingredientId, quantity] of usageThisWeek) {
      totalUsage.set(
        ingredientId,
        (totalUsage.get(ingredientId) ?? 0) + quantity,
      );
    }
  }

  return insumos.flatMap((ingredient) => {
    if (existingIngredientIds.has(ingredient.id)) return [];
    const currentStock = Math.max(0, ingredient.quantidadeEstoque ?? 0);
    const minimumStock = Math.max(0, ingredient.estoqueMinimo ?? 0);
    const averageWeeklyUsage =
      weeklyReports.length > 0
        ? (totalUsage.get(ingredient.id) ?? 0) / weeklyReports.length
        : 0;
    const requiredQuantity = Math.max(
      0,
      minimumStock + averageWeeklyUsage - currentStock,
    );
    const quantity = Number(requiredQuantity.toFixed(3));
    if (quantity <= 0) return [];

    const observation =
      weeklyReports.length > 0
        ? `Reposição: mínimo ${minimumStock} ${ingredient.unidade} + consumo médio semanal ${averageWeeklyUsage.toFixed(3)} ${ingredient.unidade} - estoque ${currentStock} ${ingredient.unidade} (${weeklyReports.length} semana(s)).`
        : `Reposição pelo estoque mínimo: mínimo ${minimumStock} ${ingredient.unidade} - estoque ${currentStock} ${ingredient.unidade}.`;

    return [
      {
        insumoId: ingredient.id,
        nome: ingredient.nome,
        quantidade: quantity,
        unidade: ingredient.unidade,
        categoria: ingredient.categoria,
        observacao: observation,
      },
    ];
  });
}
