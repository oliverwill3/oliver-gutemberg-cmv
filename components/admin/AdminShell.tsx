"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { canAccessAdminPath } from "@/lib/auth/permissions";
import type { UserProfile } from "@/types";

const navigation = [
  { href: "/admin/insumos", label: "Insumos" },
  { href: "/admin/compras", label: "Compras e notas" },
  { href: "/admin/fichas-tecnicas", label: "Fichas técnicas" },
  { href: "/admin/lista-compras", label: "Lista de compras" },
  { href: "/admin/cardapio", label: "Cardápio" },
];

export function AdminShell({
  children,
  userEmail,
  onSignOut,
  profile,
}: {
  children: ReactNode;
  userEmail?: string;
  onSignOut?: () => void;
  profile?: UserProfile | null;
}) {
  const pathname = usePathname();
  const visibleNavigation =
    profile === undefined
      ? navigation
      : profile
        ? navigation.filter((item) => canAccessAdminPath(item.href, profile.role))
        : [];
  const canOpenCurrentPath =
    !profile || canAccessAdminPath(pathname, profile.role);

  return (
    <div className="admin-shell">
      <aside className="sidebar">
        <Link className="brand" href="/admin/insumos">
          <div className="brand-mark">Oliver Gutemberg</div>
          <div className="brand-name">Gestão &amp; CMV</div>
          <div className="brand-caption">Inteligência para o salão</div>
        </Link>
        <div className="nav-label">Operação</div>
        <nav className="nav-list" aria-label="Navegação administrativa">
          {visibleNavigation.map((item) => (
            <Link
              className={`nav-link${pathname === item.href ? " active" : ""}`}
              href={item.href}
              key={item.href}
            >
              {item.label}
            </Link>
          ))}
          {(!profile ||
            canAccessAdminPath("/admin/configuracoes", profile.role)) && (
            <Link
              className={`nav-link${pathname.startsWith("/admin/configuracoes") ? " active" : ""}`}
              href="/admin/configuracoes"
            >
              Configurações
            </Link>
          )}
        </nav>
        <div className="nav-label">Cliente</div>
        <nav className="nav-list" aria-label="Módulos de cliente">
          <Link
            className="nav-link"
            href={profile ? `/menu?loja=${encodeURIComponent(profile.storeId)}` : "/menu"}
            rel="noopener noreferrer"
            target="_blank"
          >
            Cardápio digital ↗
          </Link>
        </nav>
        <div className="sidebar-footer">
          Controle de custos com mais clareza, do recebimento ao prato servido.
        </div>
      </aside>
      <div className="main-area">
        <header className="topbar">
          <div className="topbar-label">Painel administrativo</div>
          {userEmail ? (
            <div className="user-chip">
              <span className="avatar">{userEmail.slice(0, 1).toUpperCase()}</span>
              <span>{userEmail}</span>
              {onSignOut ? (
                <button className="icon-button" onClick={onSignOut} type="button">
                  Sair
                </button>
              ) : null}
            </div>
          ) : (
            <span className="status">Ambiente de gestão</span>
          )}
        </header>
        <main className="content">
          {canOpenCurrentPath ? (
            children
          ) : (
            <div className="notice error" role="alert">
              Seu perfil não tem permissão para acessar esta área.
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
