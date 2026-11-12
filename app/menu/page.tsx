"use client";

import { collection, onSnapshot, query, where } from "firebase/firestore";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { CategoryFilter } from "@/components/menu/CategoryFilter";
import { getFirebaseServices, isFirebaseConfigured } from "@/lib/firebase";
import type { Produto } from "@/types";

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function subscribeToLocation(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
}

function getTableNumber() {
  return new URLSearchParams(window.location.search).get("mesa");
}

function getStoreId() {
  return new URLSearchParams(window.location.search).get("loja");
}

export default function MenuPage() {
  const [products, setProducts] = useState<Produto[]>([]);
  const [loadedStoreId, setLoadedStoreId] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("Todos");
  const tableNumber = useSyncExternalStore(
    subscribeToLocation,
    getTableNumber,
    () => null,
  );
  const storeId = useSyncExternalStore(subscribeToLocation, getStoreId, () => null);
  const [loading, setLoading] = useState(isFirebaseConfigured);
  const [error, setError] = useState(
    isFirebaseConfigured ? "" : "O cardápio digital ainda não foi conectado ao Firebase.",
  );

  useEffect(() => {
    if (!isFirebaseConfigured) {
      return;
    }
    if (!storeId || !/^[A-Za-z0-9_-]+$/.test(storeId)) return;

    try {
      const { db } = getFirebaseServices();
      return onSnapshot(
        query(
          collection(db, "produtos"),
          where("storeId", "==", storeId),
          where("disponivel", "==", true),
        ),
        (snapshot) => {
          const items = snapshot.docs.map(
            (item) => ({ id: item.id, ...item.data() }) as Produto,
          );
          items.sort(
            (a, b) => {
              const categoryOrder = a.categoriaNome.localeCompare(
                b.categoriaNome,
                "pt-BR",
              );
              if (categoryOrder !== 0) return categoryOrder;
              const aOrder = typeof a.ordem === "number" && Number.isFinite(a.ordem)
                ? a.ordem
                : Number.MAX_SAFE_INTEGER;
              const bOrder = typeof b.ordem === "number" && Number.isFinite(b.ordem)
                ? b.ordem
                : Number.MAX_SAFE_INTEGER;
              return aOrder - bOrder || a.nome.localeCompare(b.nome, "pt-BR");
            },
          );
          setProducts(items);
          setLoadedStoreId(storeId);
          setLoading(false);
        },
        (listenerError) => {
          setError(listenerError.message);
          setLoading(false);
        },
      );
    } catch (firebaseError) {
      // Service initialization fails synchronously; report it in the menu.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError(
        firebaseError instanceof Error
          ? firebaseError.message
          : "Não foi possível conectar ao cardápio.",
      );
      setLoading(false);
    }
  }, [storeId]);

  const categories = useMemo(
    () => [...new Set(products.map((product) => product.categoriaNome))].sort(),
    [products],
  );
  const visibleProducts = (loadedStoreId === storeId ? products : []).filter(
    (product) =>
      product.disponivel &&
      (selectedCategory === "Todos" ||
        product.categoriaNome === selectedCategory),
  );
  const menuError =
    error ||
    (storeId && /^[A-Za-z0-9_-]+$/.test(storeId)
      ? ""
      : "Este cardápio precisa de um identificador de loja válido no link.");

  return (
    <main className="customer-menu">
      <header className="customer-header">
        <div className="brand-mark">Oliver Gutemberg</div>
        <div className="brand-name">Cardápio</div>
        {tableNumber ? (
          <div className="brand-caption">Atendimento à mesa {tableNumber}</div>
        ) : null}
      </header>
      <div className="customer-content">
        {menuError ? <div className="notice">{menuError}</div> : null}
        <CategoryFilter
          categories={categories}
          onSelect={setSelectedCategory}
          selected={selectedCategory}
        />
        {loading && !menuError ? (
          <div className="loading-state">Carregando cardápio…</div>
        ) : visibleProducts.length === 0 ? (
          <div className="empty-state">
            {products.length === 0
              ? "Os produtos do cardápio serão exibidos aqui."
              : "Não há itens disponíveis nesta categoria no momento."}
          </div>
        ) : (
          <div className="menu-grid">
            {visibleProducts.map((product) => (
              <article className="panel menu-item" key={product.id}>
                <div>
                  <h2>{product.nome}</h2>
                  <p>{product.descricao}</p>
                </div>
                <div className="menu-price">{currency.format(product.preco)}</div>
              </article>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
