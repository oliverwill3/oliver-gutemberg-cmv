import type { UserProfile, UserRole } from "@/types";

const routeRoles: Record<string, UserRole[]> = {
  "/admin/insumos": [
    "super_admin",
    "owner",
    "manager",
    "purchasing",
    "kitchen_bar",
  ],
  "/admin/compras": ["super_admin", "owner", "manager", "purchasing"],
  "/admin/fichas-tecnicas": [
    "super_admin",
    "owner",
    "manager",
    "kitchen_bar",
  ],
  "/admin/lista-compras": [
    "super_admin",
    "owner",
    "manager",
    "purchasing",
    "kitchen_bar",
  ],
  "/admin/cardapio": ["super_admin", "owner", "manager"],
  "/admin/configuracoes": ["super_admin", "owner", "manager"],
};

export function canAccessAdminPath(path: string, role: UserRole): boolean {
  const route = Object.keys(routeRoles).find(
    (candidate) => path === candidate || path.startsWith(`${candidate}/`),
  );
  return route ? routeRoles[route].includes(role) : false;
}

export function canManageIngredients(role: UserRole): boolean {
  return role !== "kitchen_bar";
}

export function canReadFinancialData(role: UserRole): boolean {
  return role !== "kitchen_bar";
}

export function canApprovePurchaseList(role: UserRole): boolean {
  return role === "super_admin" || role === "owner" || role === "manager";
}

export function isValidUserProfile(
  value: unknown,
  uid: string,
): UserProfile | null {
  if (typeof value !== "object" || value === null) return null;
  const data = value as Record<string, unknown>;
  const roles: UserRole[] = [
    "super_admin",
    "owner",
    "manager",
    "purchasing",
    "kitchen_bar",
  ];
  if (
    typeof data.role !== "string" ||
    !roles.includes(data.role as UserRole) ||
    typeof data.storeId !== "string" ||
    !/^[A-Za-z0-9_-]+$/.test(data.storeId)
  ) {
    return null;
  }
  return { uid, role: data.role as UserRole, storeId: data.storeId };
}
