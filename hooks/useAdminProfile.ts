"use client";

import { useEffect, useState } from "react";
import { getFirebaseServices } from "@/lib/firebase";
import { loadAdminProfile } from "@/lib/auth/admin-profile";
import type { UserProfile } from "@/types";
import type { User } from "firebase/auth";

interface ProfileResult {
  uid: string;
  profile: UserProfile | null;
  error: string;
}

export function useAdminProfile(user: User | null) {
  const [result, setResult] = useState<ProfileResult | null>(null);

  useEffect(() => {
    if (!user) return;
    let active = true;
    loadAdminProfile(getFirebaseServices().db, user.uid)
      .then(({ profile, error }) => {
        if (!active) return;
        setResult({
          uid: user.uid,
          profile,
          error,
        });
      })
      .catch((error: unknown) => {
        if (active) {
          setResult({
            uid: user.uid,
            profile: null,
            error:
              error instanceof Error
                ? error.message
                : "Não foi possível carregar o perfil de acesso.",
          });
        }
      });
    return () => {
      active = false;
    };
  }, [user]);

  const current = result?.uid === user?.uid ? result : null;
  return {
    profile: current?.profile ?? null,
    error: current?.error ?? "",
    loading: Boolean(user && !current),
  };
}
