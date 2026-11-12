import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, beforeEach, test } from "node:test";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";

const projectId = "demo-oliver-gutemberg-cmv";
let testEnv;

before(async () => {
  const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: { rules },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const records = [
      ["userProfiles/owner-a", { role: "owner", storeId: "store-a" }],
      ["userProfiles/purchasing-a", { role: "purchasing", storeId: "store-a" }],
      ["userProfiles/kitchen-a", { role: "kitchen_bar", storeId: "store-a" }],
      ["userProfiles/owner-b", { role: "owner", storeId: "store-b" }],
      ["Usuarios/owner-legacy", { role: "owner", storeId: "store-a" }],
      ["insumos/ingredient-a", { storeId: "store-a", nome: "Tomate" }],
      ["insumos/ingredient-b", { storeId: "store-b", nome: "Queijo" }],
      [
        "insumoFinancas/ingredient-a",
        { storeId: "store-a", custoUnitario: 2 },
      ],
      [
        "fichasTecnicas/product-a",
        { storeId: "store-a", produtoId: "product-a", itens: [] },
      ],
      [
        "fichaTecnicaFinancas/product-a",
        { storeId: "store-a", custoTotal: 2 },
      ],
      ["produtoCustos/product-a", { storeId: "store-a", custoFicha: 2 }],
      [
        "produtos/product-a",
        { storeId: "store-a", disponivel: true, nome: "Prato A" },
      ],
      [
        "produtos/product-hidden",
        { storeId: "store-a", disponivel: false, nome: "Oculto" },
      ],
      [
        "produtos/product-b",
        { storeId: "store-b", disponivel: true, nome: "Prato B" },
      ],
    ];
    for (const [path, data] of records) {
      await setDoc(doc(db, path), data);
    }
  });
});

async function seedPurchaseListItem() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "stores/store-a/purchaseLists/current"), {
      storeId: "store-a",
      status: "open",
      createdBy: "owner-a",
    });
    await setDoc(doc(db, "stores/store-a/purchaseLists/current/items/item-a"), {
      nome: "Tomate",
      quantidade: 2,
      unidade: "kg",
      categoria: "Hortifruti",
      insumoId: "ingredient-a",
      novoItem: false,
      origem: "manual",
      status: "requested",
      observacao: "",
      criadoPor: "owner-a",
      criadoPorEmail: "owner@example.com",
      criadoEm: "2026-01-01T10:00:00.000Z",
    });
  });
}

after(async () => {
  await testEnv?.cleanup();
});

test("private store data is limited to the member's store", async () => {
  const db = testEnv.authenticatedContext("owner-a").firestore();
  const result = await assertSucceeds(
    getDocs(query(collection(db, "insumos"), where("storeId", "==", "store-a"))),
  );
  assert.equal(result.size, 1);
  await assertFails(getDoc(doc(db, "insumos", "ingredient-b")));
});

test("public menu exposes only products marked available", async () => {
  const db = testEnv.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(db, "produtos", "product-a")));
  await assertFails(getDoc(doc(db, "produtos", "product-hidden")));
});

test("purchasing cannot write operational or financial documents directly", async () => {
  const db = testEnv.authenticatedContext("purchasing-a").firestore();
  await assertFails(
    setDoc(doc(db, "insumos", "new-ingredient"), {
      storeId: "store-a",
      nome: "Cebola",
    }),
  );
  await assertSucceeds(getDoc(doc(db, "insumoFinancas", "ingredient-a")));
  await assertFails(
    setDoc(doc(db, "produtos", "new-product"), {
      storeId: "store-a",
      disponivel: true,
      nome: "Prato",
    }),
  );
});

test("kitchen can read recipe structure but cannot access costs or write directly", async () => {
  const db = testEnv.authenticatedContext("kitchen-a").firestore();
  await assertSucceeds(getDoc(doc(db, "fichasTecnicas", "product-a")));
  await assertFails(getDoc(doc(db, "fichaTecnicaFinancas", "product-a")));
  await assertFails(getDoc(doc(db, "produtoCustos", "product-a")));
  await assertFails(
    setDoc(doc(db, "fichasTecnicas", "product-a"), {
      storeId: "store-a",
      produtoId: "product-a",
    }),
  );
  await assertFails(
    updateDoc(doc(db, "insumos", "ingredient-a"), { nome: "Alterado" }),
  );
  await assertFails(
    setDoc(doc(db, "fichasTecnicas", "product-b"), {
      storeId: "store-b",
      produtoId: "product-b",
    }),
  );
});

test("legacy Usuarios profiles are accepted for store access", async () => {
  const db = testEnv.authenticatedContext("owner-legacy").firestore();
  await assertSucceeds(getDoc(doc(db, "insumos", "ingredient-a")));
  await assertFails(getDoc(doc(db, "insumos", "ingredient-b")));
});

test("financial values cannot be added to public menu products", async () => {
  const db = testEnv.authenticatedContext("owner-a").firestore();
  await assertFails(
    updateDoc(doc(db, "produtos", "product-a"), { cmvAtual: 0.3 }),
  );
  await assertFails(
    setDoc(doc(db, "compras", "fake-purchase"), {
      storeId: "store-a",
      status: "confirmada",
      usuarioId: "purchasing-a",
    }),
  );
});

test("users cannot edit their own role profile", async () => {
  const db = testEnv.authenticatedContext("owner-a").firestore();
  await assertFails(
    updateDoc(doc(db, "userProfiles", "owner-a"), { role: "super_admin" }),
  );
});

test("members can read a missing purchase list before creating it", async () => {
  const db = testEnv.authenticatedContext("owner-a").firestore();
  const listRef = doc(db, "stores", "store-a", "purchaseLists", "current");
  await assertSucceeds(getDoc(listRef));
  await assertSucceeds(
    setDoc(listRef, {
      storeId: "store-a",
      status: "open",
      createdBy: "owner-a",
      createdAt: serverTimestamp(),
    }),
  );
});

test("purchasing can record purchase details and mark items purchased, but cannot delete", async () => {
  await seedPurchaseListItem();
  const db = testEnv
    .authenticatedContext("purchasing-a", { email: "purchasing@example.com" })
    .firestore();
  const itemRef = doc(
    db,
    "stores",
    "store-a",
    "purchaseLists",
    "current",
    "items",
    "item-a",
  );
  await assertSucceeds(
    updateDoc(itemRef, {
      comentarioCompras: "Fornecedor confirmou entrega amanhã.",
      valorUnitario: 3.25,
      valorTotal: 6.5,
    }),
  );
  await assertSucceeds(
    updateDoc(itemRef, {
      status: "purchased",
      compradoPor: "purchasing-a",
      compradoPorEmail: "purchasing@example.com",
      compradoEm: serverTimestamp(),
    }),
  );
  await assertFails(updateDoc(itemRef, { quantidade: 4 }));
  await assertFails(updateDoc(itemRef, { status: "requested" }));
  await assertFails(deleteDoc(itemRef));
});

test("weekly sales can be imported by purchasing and read by list members", async () => {
  const purchaser = testEnv
    .authenticatedContext("purchasing-a", { email: "purchasing@example.com" })
    .firestore();
  await assertSucceeds(
    setDoc(doc(purchaser, "stores", "store-a", "weeklySales", "2026-03-02"), {
      storeId: "store-a",
      semanaInicio: "2026-03-02",
      itens: [
        {
          produtoId: "product-a",
          produtoNome: "Prato A",
          unidadesVendidas: 12,
        },
      ],
      importadoPor: "purchasing-a",
      importadoPorEmail: "purchasing@example.com",
      importadoEm: serverTimestamp(),
    }),
  );

  const kitchen = testEnv.authenticatedContext("kitchen-a").firestore();
  await assertSucceeds(
    getDoc(doc(kitchen, "stores", "store-a", "weeklySales", "2026-03-02")),
  );
  await assertFails(
    setDoc(doc(kitchen, "stores", "store-a", "weeklySales", "2026-03-09"), {
      storeId: "store-a",
      semanaInicio: "2026-03-09",
      itens: [
        {
          produtoId: "product-a",
          produtoNome: "Prato A",
          unidadesVendidas: 12,
        },
      ],
      importadoPor: "kitchen-a",
      importadoPorEmail: "kitchen@example.com",
      importadoEm: serverTimestamp(),
    }),
  );
});

test("owners also cannot delete purchase list items", async () => {
  await seedPurchaseListItem();
  const db = testEnv.authenticatedContext("owner-a").firestore();
  await assertFails(
    deleteDoc(
      doc(
        db,
        "stores",
        "store-a",
        "purchaseLists",
        "current",
        "items",
        "item-a",
      ),
    ),
  );
});
