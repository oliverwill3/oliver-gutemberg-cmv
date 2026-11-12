"use client";

import { useMemo, useState } from "react";
import {
  calcularCustoTotalPrato,
  calcularMargemLucro,
} from "@/lib/utils/cmv";
import type {
  FichaTecnica,
  Insumo,
  Produto,
  TipoMetaPrecificacao,
} from "@/types";
import type { FichaTecnicaInput } from "@/lib/firestore/fichas-tecnicas";

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});
const percent = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 1,
});

function formatPercent(value: number) {
  return `${percent.format(value * 100)}%`;
}

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Não foi possível salvar a ficha técnica.";
}

export function RecipeManager({
  products,
  insumos,
  fichas,
  onSave,
  onDelete,
  busy,
}: {
  products: Produto[];
  insumos: Insumo[];
  fichas: FichaTecnica[];
  onSave: (input: FichaTecnicaInput) => Promise<void>;
  onDelete: (produtoId: string) => Promise<void>;
  busy: boolean;
}) {
  const [selectedProductId, setSelectedProductId] = useState("");
  const selectedProduct =
    products.find((product) => product.id === selectedProductId) ?? products[0];
  const ficha = fichas.find(
    (item) => (item.produtoId || item.id) === selectedProduct?.id,
  );

  if (products.length === 0) {
    return (
      <div className="notice">
        Não há produtos cadastrados no cardápio. Cadastre ao menos um produto na
        coleção <code>produtos</code> para montar uma ficha técnica.
      </div>
    );
  }

  return (
    <>
      <section className="panel recipe-product-picker">
        <div className="panel-body">
          <div className="field">
            <label htmlFor="produto-ficha">Produto do cardápio</label>
            <select
              id="produto-ficha"
              onChange={(event) => setSelectedProductId(event.target.value)}
              value={selectedProduct?.id ?? ""}
            >
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.nome}
                  {product.categoriaNome ? ` · ${product.categoriaNome}` : ""}
                </option>
              ))}
            </select>
          </div>
          {selectedProduct ? (
            <div className="recipe-product-meta">
              <span>
                Preço atual:{" "}
                <strong>{currency.format(selectedProduct.preco || 0)}</strong>
              </span>
              <span className={ficha ? "status" : "recipe-status-pending"}>
                {ficha ? "Ficha cadastrada" : "Sem ficha técnica"}
              </span>
            </div>
          ) : null}
        </div>
      </section>

      {selectedProduct ? (
        <RecipeEditor
          busy={busy}
          ficha={ficha}
          insumos={insumos}
          key={selectedProduct.id}
          onDelete={() => onDelete(selectedProduct.id)}
          onSave={onSave}
          product={selectedProduct}
        />
      ) : null}
    </>
  );
}

function RecipeEditor({
  product,
  insumos,
  ficha,
  onSave,
  onDelete,
  busy,
}: {
  product: Produto;
  insumos: Insumo[];
  ficha?: FichaTecnica;
  onSave: (input: FichaTecnicaInput) => Promise<void>;
  onDelete: () => Promise<void>;
  busy: boolean;
}) {
  const [lines, setLines] = useState(
    () =>
      ficha?.itens.map((item) => ({
        insumoId: item.insumoId,
        quantidade: String(item.quantidade),
      })) ?? [],
  );
  const [yieldAmount, setYieldAmount] = useState(
    String(ficha?.rendimento ?? 1),
  );
  const [salePrice, setSalePrice] = useState(
    String(ficha?.precoVenda ?? product.preco ?? ""),
  );
  const [targetType, setTargetType] = useState<TipoMetaPrecificacao>(
    ficha?.tipoMeta ?? "cmv",
  );
  const [targetPercent, setTargetPercent] = useState(
    String(ficha?.percentualMeta ?? 30),
  );
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const insumosPorId = useMemo(
    () => new Map(insumos.map((insumo) => [insumo.id, insumo])),
    [insumos],
  );
  const validItems = lines.flatMap((line) => {
    const insumo = insumosPorId.get(line.insumoId);
    const quantity = Number(line.quantidade);
    if (!insumo || !Number.isFinite(quantity) || quantity <= 0) return [];
    return [
      {
        insumoId: insumo.id,
        insumoNome: insumo.nome,
        quantidade: quantity,
        unidade: insumo.unidade,
        custoUnitario: insumo.custoUnitario,
        custoTotal: insumo.custoUnitario * quantity,
      },
    ];
  });
  const batchCost = calcularCustoTotalPrato(validItems);
  const portions = Number(yieldAmount);
  const portionCost =
    Number.isFinite(portions) && portions > 0 ? batchCost / portions : 0;
  const price = Number(salePrice);
  const actualCmv =
    Number.isFinite(price) && price > 0 ? portionCost / price : null;
  const actualMargin =
    Number.isFinite(price) && price > 0
      ? calcularMargemLucro(price, portionCost)
      : null;
  const target = Number(targetPercent);
  const suggestedPrice =
    Number.isFinite(target) &&
    target > 0 &&
    target <= 100 &&
    (targetType === "cmv" || target < 100)
      ? targetType === "cmv"
        ? portionCost / (target / 100)
        : portionCost / (1 - target / 100)
      : null;
  const missingIngredient = lines.some(
    (line) => line.insumoId && !insumosPorId.has(line.insumoId),
  );

  function updateLine(
    index: number,
    patch: Partial<(typeof lines)[number]>,
  ) {
    setLines((current) =>
      current.map((line, lineIndex) =>
        lineIndex === index ? { ...line, ...patch } : line,
      ),
    );
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    try {
      await onSave({
        produto: product,
        insumos,
        itens: lines
          .filter((line) => line.insumoId)
          .map((line) => ({
            insumoId: line.insumoId,
            quantidade: Number(line.quantidade),
          })),
        rendimento: Number(yieldAmount),
        precoVenda: Number(salePrice),
        tipoMeta: targetType,
        percentualMeta: Number(targetPercent),
      });
      setNotice("Ficha técnica e indicadores do produto atualizados.");
    } catch (saveError) {
      setError(errorMessage(saveError));
    }
  }

  async function remove() {
    if (!window.confirm(`Remover a ficha técnica de "${product.nome}"?`)) return;
    setError("");
    setNotice("");
    try {
      await onDelete();
      setLines([]);
      setYieldAmount("1");
      setNotice("Ficha técnica removida.");
    } catch (deleteError) {
      setError(errorMessage(deleteError));
    }
  }

  return (
    <form onSubmit={submit}>
      <section className="panel recipe-panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">Composição da ficha</h2>
            <div className="item-subtitle">
              Quantidades informadas na unidade de medida do insumo.
            </div>
          </div>
          <button
            className="button button-secondary"
            disabled={insumos.length === 0}
            onClick={() =>
              setLines((current) => [
                ...current,
                { insumoId: "", quantidade: "" },
              ])
            }
            type="button"
          >
            + Adicionar insumo
          </button>
        </div>

        {insumos.length === 0 ? (
          <div className="empty-state">
            Cadastre insumos antes de montar uma ficha técnica.
          </div>
        ) : lines.length === 0 ? (
          <div className="empty-state">
            Adicione os insumos usados para preparar este produto.
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table recipe-table">
              <thead>
                <tr>
                  <th>Insumo</th>
                  <th>Quantidade</th>
                  <th>Custo unitário</th>
                  <th>Custo na receita</th>
                  <th aria-label="Ações" />
                </tr>
              </thead>
              <tbody>
                {lines.map((line, index) => {
                  const ingredient = insumosPorId.get(line.insumoId);
                  const quantity = Number(line.quantidade);
                  const lineCost =
                    ingredient && Number.isFinite(quantity) && quantity > 0
                      ? ingredient.custoUnitario * quantity
                      : 0;
                  return (
                    <tr key={`${index}-${line.insumoId}`}>
                      <td>
                        <select
                          aria-label={`Insumo ${index + 1}`}
                          onChange={(event) =>
                            updateLine(index, { insumoId: event.target.value })
                          }
                          required
                          value={line.insumoId}
                        >
                          <option value="">Selecione um insumo</option>
                          {!ingredient && line.insumoId ? (
                            <option value={line.insumoId}>
                              Insumo indisponível — remova esta linha
                            </option>
                          ) : null}
                          {insumos.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.nome} ({item.unidade})
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <div className="recipe-quantity">
                          <input
                            aria-label={`Quantidade de ${ingredient?.nome ?? "insumo"}`}
                            min="0.0001"
                            onChange={(event) =>
                              updateLine(index, {
                                quantidade: event.target.value,
                              })
                            }
                            placeholder="0"
                            required={Boolean(line.insumoId)}
                            step="any"
                            type="number"
                            value={line.quantidade}
                          />
                          <span>{ingredient?.unidade ?? "—"}</span>
                        </div>
                      </td>
                      <td>
                        {ingredient
                          ? `${currency.format(ingredient.custoUnitario)} / ${ingredient.unidade}`
                          : "—"}
                      </td>
                      <td>{currency.format(lineCost)}</td>
                      <td>
                        <button
                          aria-label={`Remover insumo ${index + 1}`}
                          className="icon-button"
                          onClick={() =>
                            setLines((current) =>
                              current.filter((_, lineIndex) => lineIndex !== index),
                            )
                          }
                          type="button"
                        >
                          Remover
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="panel-body recipe-settings">
          <div className="field">
            <label htmlFor="rendimento">
              Rendimento da receita (porções/unidades)
            </label>
            <input
              id="rendimento"
              min="0.0001"
              onChange={(event) => setYieldAmount(event.target.value)}
              required
              step="any"
              type="number"
              value={yieldAmount}
            />
            <span className="field-hint">
              O custo por porção é o custo de todos os insumos dividido pelo rendimento.
            </span>
          </div>
        </div>
      </section>

      <section className="recipe-bottom-grid">
        <div className="panel">
          <div className="panel-header">
            <h2 className="panel-title">Preço e meta</h2>
          </div>
          <div className="panel-body recipe-settings">
            <div className="field">
              <label htmlFor="preco-venda">Preço de venda atual (R$)</label>
              <input
                id="preco-venda"
                min="0"
                onChange={(event) => setSalePrice(event.target.value)}
                required
                step="0.01"
                type="number"
                value={salePrice}
              />
            </div>
            <fieldset className="target-fieldset">
              <legend>Definir preço sugerido por</legend>
              <div className="target-options">
                <label className="target-option">
                  <input
                    checked={targetType === "cmv"}
                    name="tipo-meta"
                    onChange={() => setTargetType("cmv")}
                    type="radio"
                  />
                  CMV alvo
                </label>
                <label className="target-option">
                  <input
                    checked={targetType === "margem"}
                    name="tipo-meta"
                    onChange={() => setTargetType("margem")}
                    type="radio"
                  />
                  Margem alvo
                </label>
              </div>
            </fieldset>
            <div className="field">
              <label htmlFor="percentual-meta">
                {targetType === "cmv" ? "CMV alvo (%)" : "Margem de lucro alvo (%)"}
              </label>
              <input
                id="percentual-meta"
                max={targetType === "cmv" ? "100" : "99.99"}
                min={targetType === "cmv" ? "0.01" : "0"}
                onChange={(event) => setTargetPercent(event.target.value)}
                required
                step="0.1"
                type="number"
                value={targetPercent}
              />
            </div>
            <p className="field-hint">
              A meta é usada para calcular o preço sugerido, sem substituir
              automaticamente o preço atual do produto.
            </p>
          </div>
        </div>

        <section aria-live="polite" className="panel recipe-summary">
          <div className="panel-header">
            <h2 className="panel-title">Resumo por porção</h2>
          </div>
          <div className="panel-body">
            <div className="summary-row">
              <span>Custo total da receita</span>
              <strong>{currency.format(batchCost)}</strong>
            </div>
            <div className="summary-row">
              <span>Custo por porção</span>
              <strong>{currency.format(portionCost)}</strong>
            </div>
            <div className="summary-row">
              <span>CMV atual</span>
              <strong>{actualCmv === null ? "—" : formatPercent(actualCmv)}</strong>
            </div>
            <div className="summary-row">
              <span>Margem bruta atual</span>
              <strong>
                {actualMargin === null ? "—" : formatPercent(actualMargin)}
              </strong>
            </div>
            <div className="summary-row">
              <span>{targetType === "cmv" ? "CMV alvo" : "Margem alvo"}</span>
              <strong>
                {Number.isFinite(target)
                  ? `${percent.format(target)}%`
                  : "—"}
              </strong>
            </div>
            <div className="summary-row summary-highlight">
              <span>Preço sugerido</span>
              <strong>
                {suggestedPrice === null || !Number.isFinite(suggestedPrice)
                  ? "—"
                  : currency.format(suggestedPrice)}
              </strong>
            </div>
            {suggestedPrice !== null &&
            Number.isFinite(price) &&
            price > 0 &&
            Math.abs(price - suggestedPrice) >= 0.005 ? (
              <div className="field-hint">
                Diferença para o preço atual:{" "}
                {currency.format(suggestedPrice - price)}
              </div>
            ) : null}
          </div>
        </section>
      </section>

      {missingIngredient ? (
        <div className="notice error">
          A ficha contém um insumo removido do estoque. Remova a linha indisponível
          ou selecione outro antes de salvar.
        </div>
      ) : null}
      {error ? <div className="notice error">{error}</div> : null}
      {notice ? <div className="notice success">{notice}</div> : null}

      <div className="form-actions recipe-actions">
        {ficha ? (
          <button
            className="button button-danger"
            disabled={busy}
            onClick={() => void remove()}
            type="button"
          >
            Remover ficha
          </button>
        ) : null}
        <button
          className="button button-primary"
          disabled={
            busy ||
            insumos.length === 0 ||
            lines.length === 0 ||
            missingIngredient ||
            !validItems.length
          }
          type="submit"
        >
          {busy ? "Salvando…" : ficha ? "Salvar alterações" : "Salvar ficha técnica"}
        </button>
      </div>
    </form>
  );
}
