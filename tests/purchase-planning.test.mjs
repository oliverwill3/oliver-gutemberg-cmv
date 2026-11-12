import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(
  new URL("../lib/utils/purchase-planning.ts", import.meta.url),
  "utf8",
);
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
});
const planning = await import(
  `data:text/javascript;charset=utf-8,${encodeURIComponent(outputText)}`
);

test("parses and aggregates weekly sales by normalized product name", () => {
  const produtos = [{ id: "coffee", nome: "Cafe Especial" }];
  const sales = planning.parseWeeklySalesCsv(
    'produto;quantidade\n"CAF\u00c9 ESPECIAL";1,5\nCafe Especial;2',
    produtos,
  );

  assert.deepEqual(sales, [
    {
      produtoId: "coffee",
      produtoNome: "Cafe Especial",
      unidadesVendidas: 3.5,
    },
  ]);
});

test("calculates replenishment from stock minimum and recipe-based weekly usage", () => {
  const insumo = {
    id: "beans",
    nome: "Grao",
    unidade: "kg",
    categoria: "Insumos",
    quantidadeEstoque: 3,
    estoqueMinimo: 5,
  };
  const ficha = {
    produtoId: "coffee",
    rendimento: 4,
    itens: [{ insumoId: "beans", quantidade: 2, unidade: "kg" }],
  };
  const vendas = [8, 4].map((unidadesVendidas, index) => ({
    id: `week-${index}`,
    itens: [{ produtoId: "coffee", unidadesVendidas }],
  }));
  const base = {
    insumos: [insumo],
    fichas: [ficha],
    vendas,
  };

  const suggestion = planning.calcularItensReposicao({
    ...base,
    itensExistentes: [],
  });
  assert.equal(suggestion[0].quantidade, 5);
  assert.match(suggestion[0].observacao, /3\.000 kg/);

  assert.deepEqual(
    planning.calcularItensReposicao({
      ...base,
      itensExistentes: [{ insumoId: "beans", status: "requested" }],
    }),
    [],
  );
  assert.equal(
    planning.calcularItensReposicao({
      ...base,
      itensExistentes: [{ insumoId: "beans", status: "purchased" }],
    }).length,
    1,
  );
});

test("rejects CSV products that cannot be matched to the store menu", () => {
  assert.throws(
    () =>
      planning.parseWeeklySalesCsv(
        "produto,quantidade\nProduto inexistente,2",
        [{ id: "coffee", nome: "Cafe Especial" }],
      ),
    /não encontrados no cardápio/,
  );
});
