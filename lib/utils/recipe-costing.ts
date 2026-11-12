import {
  calcularPrecoParaMargem,
  calcularPrecoSugerido,
} from "@/lib/utils/cmv";
import type { ItemFichaTecnica, TipoMetaPrecificacao } from "@/types";

export interface RecipeCosting {
  itens: Array<Pick<ItemFichaTecnica, "insumoId" | "custoUnitario" | "custoTotal">>;
  custoTotal: number;
  custoPorPorcao: number;
  precoVenda: number;
  cmvAtual: number;
  margemAtual: number;
  cmvAlvo: number;
  margemAlvo: number;
  tipoMeta: TipoMetaPrecificacao;
  percentualMeta: number;
  precoSugerido: number;
}

export function calculateRecipeCosting(input: {
  itens: Array<{
    insumoId: string;
    quantidade: number;
    custoUnitario: number;
  }>;
  rendimento: number;
  precoVenda: number;
  tipoMeta: TipoMetaPrecificacao;
  percentualMeta: number;
}): RecipeCosting {
  if (!Number.isFinite(input.rendimento) || input.rendimento <= 0) {
    throw new Error("O rendimento deve ser maior que zero.");
  }
  if (!Number.isFinite(input.precoVenda) || input.precoVenda <= 0) {
    throw new Error("O preço de venda deve ser maior que zero.");
  }
  if (
    !Number.isFinite(input.percentualMeta) ||
    input.percentualMeta < 0 ||
    input.percentualMeta > 100 ||
    (input.tipoMeta === "cmv" && input.percentualMeta === 0) ||
    (input.tipoMeta === "margem" && input.percentualMeta >= 100)
  ) {
    throw new Error("O percentual da meta de CMV/margem está inválido.");
  }
  const itens = input.itens.map((item) => {
    if (
      !item.insumoId ||
      !Number.isFinite(item.quantidade) ||
      item.quantidade <= 0 ||
      !Number.isFinite(item.custoUnitario) ||
      item.custoUnitario < 0
    ) {
      throw new Error("A ficha contém quantidade ou custo de insumo inválido.");
    }
    return {
      insumoId: item.insumoId,
      custoUnitario: item.custoUnitario,
      custoTotal: item.custoUnitario * item.quantidade,
    };
  });
  if (itens.length === 0) throw new Error("Adicione ao menos um insumo.");

  const custoTotal = itens.reduce((total, item) => total + item.custoTotal, 0);
  const custoPorPorcao = custoTotal / input.rendimento;
  const percentual = input.percentualMeta / 100;
  const precoSugerido =
    input.tipoMeta === "cmv"
      ? calcularPrecoSugerido(custoPorPorcao, percentual)
      : calcularPrecoParaMargem(custoPorPorcao, percentual);
  const cmvAlvo =
    input.tipoMeta === "cmv" ? percentual : 1 - percentual;
  const cmvAtual = custoPorPorcao / input.precoVenda;

  return {
    itens,
    custoTotal,
    custoPorPorcao,
    precoVenda: input.precoVenda,
    cmvAtual,
    margemAtual: 1 - cmvAtual,
    cmvAlvo,
    margemAlvo: 1 - cmvAlvo,
    tipoMeta: input.tipoMeta,
    percentualMeta: input.percentualMeta,
    precoSugerido,
  };
}
