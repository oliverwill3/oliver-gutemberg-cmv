import {
  collection,
  deleteField,
  doc,
  runTransaction,
  onSnapshot,
  arrayRemove,
  arrayUnion,
  type Unsubscribe,
} from "firebase/firestore";
import { getFirebaseServices } from "@/lib/firebase";
import type {
  FichaTecnica,
  Insumo,
  Produto,
  TipoMetaPrecificacao,
} from "@/types";
import {
  calcularCustoTotalPrato,
  calcularPrecoParaMargem,
  calcularPrecoSugerido,
} from "@/lib/utils/cmv";

export interface FichaTecnicaInput {
  produto: Produto;
  insumos: Insumo[];
  itens: Array<{ insumoId: string; quantidade: number }>;
  rendimento: number;
  precoVenda: number;
  tipoMeta: TipoMetaPrecificacao;
  percentualMeta: number;
}

function calculateFicha(input: FichaTecnicaInput): FichaTecnica {
  if (!input.produto.id) {
    throw new Error("Selecione um produto do cardápio.");
  }
  if (!Number.isFinite(input.rendimento) || input.rendimento <= 0) {
    throw new Error("O rendimento deve ser maior que zero.");
  }
  if (!Number.isFinite(input.precoVenda) || input.precoVenda < 0) {
    throw new Error("O preço de venda deve ser um valor válido.");
  }
  if (
    !Number.isFinite(input.percentualMeta) ||
    input.percentualMeta < 0 ||
    input.percentualMeta > 100 ||
    (input.tipoMeta === "cmv" && input.percentualMeta === 0) ||
    (input.tipoMeta === "margem" && input.percentualMeta === 100)
  ) {
    throw new Error(
      input.tipoMeta === "cmv"
        ? "O CMV alvo deve ser maior que 0% e até 100%."
        : "A margem alvo deve estar entre 0% e menos de 100%.",
    );
  }
  if (input.itens.length === 0) {
    throw new Error("Adicione ao menos um insumo à ficha técnica.");
  }

  const insumosPorId = new Map(input.insumos.map((insumo) => [insumo.id, insumo]));
  const itens = input.itens.map(({ insumoId, quantidade }) => {
    const insumo = insumosPorId.get(insumoId);
    if (!insumo) {
      throw new Error("Um insumo da ficha não está mais disponível no estoque.");
    }
    if (!Number.isFinite(quantidade) || quantidade <= 0) {
      throw new Error(`Informe uma quantidade válida para ${insumo.nome}.`);
    }
    if (!Number.isFinite(insumo.custoUnitario) || insumo.custoUnitario < 0) {
      throw new Error(`O custo unitário de ${insumo.nome} está inválido.`);
    }

    return {
      insumoId: insumo.id,
      insumoNome: insumo.nome,
      quantidade,
      unidade: insumo.unidade,
      custoUnitario: insumo.custoUnitario,
      custoTotal: insumo.custoUnitario * quantidade,
    };
  });
  const custoTotal = calcularCustoTotalPrato(itens);
  const custoPorPorcao = custoTotal / input.rendimento;
  const precoSugerido =
    input.tipoMeta === "cmv"
      ? calcularPrecoSugerido(custoPorPorcao, input.percentualMeta / 100)
      : calcularPrecoParaMargem(custoPorPorcao, input.percentualMeta / 100);

  return {
    id: input.produto.id,
    produtoId: input.produto.id,
    nome: input.produto.nome,
    rendimento: input.rendimento,
    itens,
    custoTotal,
    tipoMeta: input.tipoMeta,
    percentualMeta: input.percentualMeta,
    precoVenda: input.precoVenda,
    custoPorPorcao,
    precoSugerido,
    atualizadoEm: new Date().toISOString(),
  };
}

export async function salvarFichaTecnica(input: FichaTecnicaInput): Promise<void> {
  const { db } = getFirebaseServices();
  const fichaRef = doc(db, "fichasTecnicas", input.produto.id);
  const productRef = doc(db, "produtos", input.produto.id);

  await runTransaction(db, async (transaction) => {
    const [existingFicha, existingProduct] =
      await Promise.all([
        transaction.get(fichaRef),
        transaction.get(productRef),
      ]);
    if (!existingProduct.exists()) {
      throw new Error("O produto selecionado não existe mais no cardápio.");
    }

    const previousIngredientIds = existingFicha.exists()
      ? ((existingFicha.data().itens as FichaTecnica["itens"] | undefined) ?? [])
          .map((item) => item.insumoId)
      : [];
    const ingredientIds = [
      ...new Set([
        ...previousIngredientIds,
        ...input.itens.map((item) => item.insumoId),
      ]),
    ];
    const ingredientSnapshots = await Promise.all(
      ingredientIds.map((id) => transaction.get(doc(db, "insumos", id))),
    );
    const snapshotsById = new Map(
      ingredientSnapshots.map((snapshot) => [snapshot.id, snapshot]),
    );
    const freshIngredients = [...new Set(input.itens.map((item) => item.insumoId))]
      .map((id) => snapshotsById.get(id))
      .map((snapshot) => {
        if (!snapshot?.exists()) {
          throw new Error("Um insumo selecionado não existe mais no estoque.");
        }
        return { id: snapshot.id, ...snapshot.data() } as Insumo;
      });
    const ficha = calculateFicha({ ...input, insumos: freshIngredients });
    const cmvAtual =
      ficha.precoVenda > 0 ? ficha.custoPorPorcao / ficha.precoVenda : 0;
    const margemAtual = ficha.precoVenda > 0 ? 1 - cmvAtual : 0;
    const cmvAlvo =
      ficha.tipoMeta === "cmv"
        ? ficha.percentualMeta / 100
        : 1 - ficha.percentualMeta / 100;
    const margemAlvo = 1 - cmvAlvo;

    const nextIngredientIds = [...new Set(ficha.itens.map((item) => item.insumoId))];

    transaction.set(fichaRef, ficha);
    transaction.set(doc(db, "produtoCustos", input.produto.id), {
      id: input.produto.id,
      produtoId: input.produto.id,
      custoFicha: ficha.custoPorPorcao,
      cmvAtual,
      cmvAlvo,
      margemAtual,
      margemAlvo,
      precoSugerido: ficha.precoSugerido,
      atualizadoEm: ficha.atualizadoEm,
    });
    transaction.update(productRef, {
      preco: ficha.precoVenda,
      fichaTecnicaId: ficha.id,
      custoFicha: deleteField(),
      cmvAtual: deleteField(),
      cmvAlvo: deleteField(),
      margemAtual: deleteField(),
      margemAlvo: deleteField(),
      precoSugerido: deleteField(),
      atualizadoEm: ficha.atualizadoEm,
    });
    for (const ingredient of freshIngredients) {
      const ingredientRef = doc(db, "insumos", ingredient.id);
      transaction.update(ingredientRef, {
        fichasTecnicasIds: arrayUnion(ficha.id),
      });
    }
    for (const ingredientId of new Set(previousIngredientIds)) {
      if (nextIngredientIds.includes(ingredientId)) continue;
      const previousIngredient = snapshotsById.get(ingredientId);
      if (previousIngredient?.exists()) {
        transaction.update(previousIngredient.ref, {
          fichasTecnicasIds: arrayRemove(ficha.id),
        });
      }
    }
  });
}

export async function removerFichaTecnica(produtoId: string): Promise<void> {
  const { db } = getFirebaseServices();
  const fichaRef = doc(db, "fichasTecnicas", produtoId);
  const productRef = doc(db, "produtos", produtoId);
  await runTransaction(db, async (transaction) => {
    const [fichaSnapshot, productSnapshot] = await Promise.all([
      transaction.get(fichaRef),
      transaction.get(productRef),
    ]);
    if (!productSnapshot.exists()) {
      throw new Error("O produto associado à ficha não existe mais.");
    }
    const ingredientIds = fichaSnapshot.exists()
      ? ((fichaSnapshot.data().itens as FichaTecnica["itens"] | undefined) ?? [])
          .map((item) => item.insumoId)
      : [];
    const ingredientSnapshots = await Promise.all(
      [...new Set(ingredientIds)].map((id) =>
        transaction.get(doc(db, "insumos", id)),
      ),
    );

    transaction.delete(fichaRef);
    transaction.delete(doc(db, "produtoCustos", produtoId));
    transaction.update(productRef, {
      fichaTecnicaId: deleteField(),
      custoFicha: deleteField(),
      cmvAtual: deleteField(),
      cmvAlvo: deleteField(),
      margemAtual: deleteField(),
      margemAlvo: deleteField(),
      precoSugerido: deleteField(),
      atualizadoEm: new Date().toISOString(),
    });
    for (const ingredientSnapshot of ingredientSnapshots) {
      if (!ingredientSnapshot.exists()) continue;
      transaction.update(ingredientSnapshot.ref, {
        fichasTecnicasIds: arrayRemove(produtoId),
      });
    }
  });
}

export function observarProdutos(
  onChange: (produtos: Produto[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const { db } = getFirebaseServices();
  return onSnapshot(
    collection(db, "produtos"),
    (snapshot) => {
      const produtos = snapshot.docs.map(
        (item) => ({ id: item.id, ...item.data() }) as Produto,
      );
      produtos.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
      onChange(produtos);
    },
    onError,
  );
}

export function observarFichasTecnicas(
  onChange: (fichas: FichaTecnica[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const { db } = getFirebaseServices();
  return onSnapshot(
    collection(db, "fichasTecnicas"),
    (snapshot) => {
      const fichas = snapshot.docs.map(
        (item) => ({ id: item.id, ...item.data() }) as FichaTecnica,
      );
      onChange(fichas);
    },
    onError,
  );
}
