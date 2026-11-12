"use client";

import { useMemo } from "react";
import type { Produto } from "@/types";

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function compareProducts(a: Produto, b: Produto): number {
  const aOrder =
    typeof a.ordem === "number" && Number.isFinite(a.ordem)
      ? a.ordem
      : Number.MAX_SAFE_INTEGER;
  const bOrder =
    typeof b.ordem === "number" && Number.isFinite(b.ordem)
      ? b.ordem
      : Number.MAX_SAFE_INTEGER;
  return aOrder - bOrder || a.nome.localeCompare(b.nome, "pt-BR");
}

export function MenuProductManager({
  products,
  busy,
  onMove,
}: {
  products: Produto[];
  busy: boolean;
  onMove: (category: string, from: number, to: number) => void;
}) {
  const groups = useMemo(() => {
    const grouped = new Map<string, Produto[]>();
    for (const product of products) {
      const category = product.categoriaNome?.trim() || "Sem categoria";
      grouped.set(category, [...(grouped.get(category) ?? []), product]);
    }
    return [...grouped.entries()]
      .sort(([a], [b]) => a.localeCompare(b, "pt-BR"))
      .map(([category, items]) => [
        category,
        items.sort(compareProducts),
      ] as const);
  }, [products]);

  if (products.length === 0) {
    return (
      <section className="panel">
        <div className="empty-state">
          Ainda não há produtos publicados na coleção <code>produtos</code>.
          Produtos importados por foto ou texto ficam em revisão na coleção{" "}
          <code>items</code> e não aparecem no cardápio até serem cadastrados
          como produtos.
        </div>
      </section>
    );
  }

  return (
    <div className="menu-admin-groups">
      {groups.map(([category, items]) => (
        <section className="panel menu-admin-category" key={category}>
          <div className="panel-header">
            <h2 className="panel-title">{category}</h2>
            <span className="status">
              {items.length} {items.length === 1 ? "produto" : "produtos"}
            </span>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Ordem</th>
                  <th>Produto</th>
                  <th>Preço</th>
                  <th>Disponibilidade</th>
                  <th aria-label="Ações" />
                </tr>
              </thead>
              <tbody>
                {items.map((product, index) => (
                  <tr key={product.id}>
                    <td>{index + 1}</td>
                    <td>
                      <div className="item-title">{product.nome}</div>
                      {product.descricao ? (
                        <div className="item-subtitle">{product.descricao}</div>
                      ) : null}
                    </td>
                    <td>{currency.format(product.preco)}</td>
                    <td>
                      <span
                        className={`status${product.disponivel ? "" : " status-muted"}`}
                      >
                        {product.disponivel ? "Disponível" : "Indisponível"}
                      </span>
                    </td>
                    <td>
                      <div className="menu-order-actions">
                        <button
                          aria-label={`Mover ${product.nome} para cima em ${category}`}
                          className="icon-button"
                          disabled={busy || index === 0}
                          onClick={() => onMove(category, index, index - 1)}
                          type="button"
                        >
                          ↑
                        </button>
                        <button
                          aria-label={`Mover ${product.nome} para baixo em ${category}`}
                          className="icon-button"
                          disabled={busy || index === items.length - 1}
                          onClick={() => onMove(category, index, index + 1)}
                          type="button"
                        >
                          ↓
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
