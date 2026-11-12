import { doc, getDoc, type Firestore } from "firebase/firestore";
import { isValidUserProfile } from "@/lib/auth/permissions";
import type { UserProfile } from "@/types";

export async function loadAdminProfile(
  db: Firestore,
  uid: string,
): Promise<{ profile: UserProfile | null; error: string }> {
  const [primary, alternate] = await Promise.all([
    getDoc(doc(db, "userProfiles", uid)),
    getDoc(doc(db, "Usuarios", uid)),
  ]);
  const snapshot = primary.exists() ? primary : alternate;
  if (!snapshot.exists()) {
    return {
      profile: null,
      error: `Seu usuário ainda não tem perfil operacional. Cadastre userProfiles/${uid} ou Usuarios/${uid} no Firestore.`,
    };
  }
  const profile = isValidUserProfile(snapshot.data(), uid);
  return {
    profile,
    error: profile
      ? ""
      : "O perfil precisa conter um papel válido e um storeId válido.",
  };
}
