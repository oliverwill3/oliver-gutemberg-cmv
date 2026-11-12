import type { ItemFichaTecnica } from "@/types";

export function calcularCustoUnitarioInsumo(
  precoCompra: number,
  quantidadeCompra: number,
  fatorCorrecao: number,
): number {
  if (
    !Number.isFinite(precoCompra) ||
    !Number.isFinite(quantidadeCompra) ||
    !Number.isFinite(fatorCorrecao) ||
    precoCompra < 0 ||
    quantidadeCompra <= 0 ||
    fatorCorrecao < 1
  ) {
    throw new Error(
      "Informe preço não negativo, quantidade maior que zero e fator de correção igual ou maior que 1.",
    );
  }

  return (precoCompra / quantidadeCompra) * fatorCorrecao;
}

export function calcularCustoTotalPrato(itens: ItemFichaTecnica[]): number {
  return itens.reduce((total, item) => {
    if (!Number.isFinite(item.custoTotal) || item.custoTotal < 0) {
      throw new Error("Os custos dos itens da ficha técnica devem ser válidos.");
    }
    return total + item.custoTotal;
  }, 0);
}

export function calcularMargemLucro(
  precoVenda: number,
  custoTotal: number,
): number {
  if (
    !Number.isFinite(precoVenda) ||
    !Number.isFinite(custoTotal) ||
    precoVenda <= 0 ||
    custoTotal < 0
  ) {
    throw new Error("Preço de venda e custo total devem ser valores válidos.");
  }

  return (precoVenda - custoTotal) / precoVenda;
}

export function calcularPrecoSugerido(
  custoTotal: number,
  cmvAlvo: number,
): number {
  if (
    !Number.isFinite(custoTotal) ||
    !Number.isFinite(cmvAlvo) ||
    custoTotal < 0 ||
    cmvAlvo <= 0 ||
    cmvAlvo > 1
  ) {
    throw new Error("O CMV alvo deve estar entre 0% e 100%.");
  }

  return Math.round((custoTotal / cmvAlvo) * 100) / 100;
}

export function calcularPrecoParaMargem(
  custoTotal: number,
  margemAlvo: number,
): number {
  if (
    !Number.isFinite(custoTotal) ||
    !Number.isFinite(margemAlvo) ||
    custoTotal < 0 ||
    margemAlvo < 0 ||
    margemAlvo >= 1
  ) {
    throw new Error("A margem alvo deve ser igual ou maior que 0% e menor que 100%.");
  }

  return Math.round((custoTotal / (1 - margemAlvo)) * 100) / 100;
}
