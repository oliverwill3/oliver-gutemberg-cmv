import type { NextRequest } from "next/server";
import { isValidUserProfile } from "@/lib/auth/permissions";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import type { UserProfile, UserRole } from "@/types";

export class AuthorizationError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function authenticateAdminRequest(
  request: NextRequest,
): Promise<UserProfile> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    throw new AuthorizationError("Autenticação necessária.", 401);
  }

  let uid: string;
  try {
    const token = await adminAuth.verifyIdToken(authorization.slice(7));
    uid = token.uid;
  } catch {
    throw new AuthorizationError("Sua sessão expirou. Entre novamente.", 401);
  }

  const [primary, alternate] = await Promise.all([
    adminDb.collection("userProfiles").doc(uid).get(),
    adminDb.collection("Usuarios").doc(uid).get(),
  ]);
  const profileDocument = primary.exists ? primary : alternate;
  if (!profileDocument.exists) {
    throw new AuthorizationError("Perfil operacional não encontrado.", 403);
  }
  const profile = isValidUserProfile(profileDocument.data(), uid);
  if (!profile) {
    throw new AuthorizationError("Perfil operacional inválido.", 403);
  }
  return profile;
}

export function authorizeStoreRole(
  profile: UserProfile,
  storeId: string,
  roles: UserRole[],
): void {
  if (!storeId || !/^[A-Za-z0-9_-]+$/.test(storeId)) {
    throw new AuthorizationError("Loja inválida.", 400);
  }
  if (profile.role !== "super_admin" && profile.storeId !== storeId) {
    throw new AuthorizationError("Acesso negado a esta loja.", 403);
  }
  if (!roles.includes(profile.role)) {
    throw new AuthorizationError("Seu perfil não pode executar esta operação.", 403);
  }
}

export function apiErrorResponse(error: unknown): Response {
  if (error instanceof AuthorizationError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof Error) {
    return Response.json({ error: error.message }, { status: 400 });
  }
  return Response.json(
    { error: "Ocorreu um erro inesperado no servidor." },
    { status: 500 },
  );
}
