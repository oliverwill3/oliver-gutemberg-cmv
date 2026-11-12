import { doc, getDoc, type Firestore } from "firebase/firestore";
import { isValidUserProfile } from "@/lib/auth/permissions";
import type { UserProfile } from "@/types";

function isPermissionDenied(
  error: unknown,
): error is { code: "permission-denied" } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "permission-denied"
  );
}

export async function loadAdminProfile(
  db: Firestore,
  uid: string,
): Promise<{ profile: UserProfile | null; error: string }> {
  let primary;
  try {
    primary = await getDoc(doc(db, "userProfiles", uid));
  } catch (error) {
    if (!isPermissionDenied(error)) throw error;
    console.warn(
      "Could not read userProfiles profile; trying Usuarios fallback.",
    );
  }
  const snapshot =
    primary?.exists() === true
      ? primary
      : await getDoc(doc(db, "Usuarios", uid));
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
