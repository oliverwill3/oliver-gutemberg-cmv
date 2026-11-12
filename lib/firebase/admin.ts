import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
} from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getAdminApp() {
  const existing = getApps().find((app) => app.name === "oliver-admin");
  if (existing) return existing;

  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!projectId) {
    throw new Error("NEXT_PUBLIC_FIREBASE_PROJECT_ID não foi configurado.");
  }

  const serviceAccount = process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT;
  if (serviceAccount) {
    let credentials: unknown;
    try {
      credentials = JSON.parse(serviceAccount);
    } catch {
      throw new Error("FIREBASE_ADMIN_SERVICE_ACCOUNT precisa conter JSON válido.");
    }
    if (!isRecord(credentials)) {
      throw new Error(
        "FIREBASE_ADMIN_SERVICE_ACCOUNT não contém as credenciais de serviço necessárias.",
      );
    }
    if (
      typeof credentials.project_id !== "string" ||
      typeof credentials.client_email !== "string" ||
      typeof credentials.private_key !== "string"
    ) {
      throw new Error(
        "FIREBASE_ADMIN_SERVICE_ACCOUNT não contém as credenciais de serviço necessárias.",
      );
    }
    return initializeApp(
      {
        credential: cert({
          projectId: credentials.project_id,
          clientEmail: credentials.client_email,
          privateKey: credentials.private_key,
        }),
        projectId,
      },
      "oliver-admin",
    );
  }

  return initializeApp(
    { credential: applicationDefault(), projectId },
    "oliver-admin",
  );
}

const app = getAdminApp();

export const adminAuth = getAuth(app);
export const adminDb = getFirestore(app);
