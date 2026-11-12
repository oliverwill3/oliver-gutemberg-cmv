import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  updateDoc,
  type Unsubscribe,
} from "firebase/firestore";
import { getFirebaseServices } from "@/lib/firebase";
import type { Insumo } from "@/types";

type InsumoInput = Omit<Insumo, "id">;

export function observarInsumos(
  onChange: (insumos: Insumo[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const { db } = getFirebaseServices();
  return onSnapshot(
    collection(db, "insumos"),
    (snapshot) => {
      const insumos = snapshot.docs.map(
        (item) => ({ id: item.id, ...item.data() }) as Insumo,
      );
      insumos.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
      onChange(insumos);
    },
    (error) => onError(error),
  );
}

export async function criarInsumo(insumo: InsumoInput): Promise<void> {
  const { db } = getFirebaseServices();
  await addDoc(collection(db, "insumos"), insumo);
}

export async function atualizarInsumo(
  id: string,
  insumo: InsumoInput,
): Promise<void> {
  const { db } = getFirebaseServices();
  await updateDoc(doc(db, "insumos", id), insumo);
}

export async function removerInsumo(id: string): Promise<void> {
  const { db } = getFirebaseServices();
  await deleteDoc(doc(db, "insumos", id));
}
