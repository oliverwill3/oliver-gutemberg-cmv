import { createRemoteJWKSet, jwtVerify } from "jose";
import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_REQUEST_BYTES = 14 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png"]);
const UNITS = ["", "kg", "g", "L", "ml", "unidade", "pacote", "caixa"];
const CLASSES = ["", "insumo_producao", "compra_geral"];
const firebaseProjectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const firebaseKeys = createRemoteJWKSet(
  new URL(
    "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com",
  ),
);

type ImportType = "invoice" | "menu";

interface OcrInput {
  importType: ImportType;
  mimeType?: string;
  imageBase64?: string;
  text?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

interface AuthenticatedUser {
  uid: string;
  role: string;
}

async function authenticate(
  request: NextRequest,
): Promise<AuthenticatedUser | null> {
  if (!firebaseProjectId) return null;
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice(7);
  let uid: string;
  try {
    const { payload } = await jwtVerify(token, firebaseKeys, {
      algorithms: ["RS256"],
      issuer: `https://securetoken.google.com/${firebaseProjectId}`,
      audience: firebaseProjectId,
    });
    if (typeof payload.sub !== "string") return null;
    uid = payload.sub;
  } catch {
    return null;
  }

  const profilePaths = ["userProfiles", "Usuarios"];
  let profileDocument: unknown = null;
  for (const collectionName of profilePaths) {
    const response = await fetch(
      `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(firebaseProjectId)}/databases/(default)/documents/${collectionName}/${encodeURIComponent(uid)}`,
      {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      },
    );
    if (response.ok) {
      profileDocument = await response.json();
      break;
    }
    if (response.status !== 404) return null;
  }
  if (!profileDocument) return null;
  if (!isRecord(profileDocument) || !isRecord(profileDocument.fields)) {
    return null;
  }
  const roleField = profileDocument.fields.role;
  if (!isRecord(roleField) || typeof roleField.stringValue !== "string") {
    return null;
  }
  return { uid, role: roleField.stringValue };
}

async function readJsonBody(request: NextRequest): Promise<unknown> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_REQUEST_BYTES) {
    throw new Error("Tamanho máximo da requisição excedido.");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Corpo da requisição não informado.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_REQUEST_BYTES) {
      await reader.cancel();
      throw new Error("Tamanho máximo da requisição excedido.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

async function readOcrInput(request: NextRequest): Promise<OcrInput> {
  const contentType = request.headers.get("content-type") ?? "";
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_REQUEST_BYTES) {
    throw new Error("Tamanho máximo da requisição excedido.");
  }

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const importType = formData.get("importType");
    const image = formData.get("image");
    if (importType !== "menu") {
      throw new Error("O envio por FormData é exclusivo para cardápios.");
    }
    if (!(image instanceof File)) {
      throw new Error("Selecione uma imagem para processar.");
    }
    if (image.size > MAX_IMAGE_BYTES) {
      throw new Error("A imagem excede o limite de 10 MB.");
    }
    return {
      importType,
      mimeType: image.type,
      imageBase64: Buffer.from(await image.arrayBuffer()).toString("base64"),
    };
  }

  if (!contentType.includes("application/json")) {
    throw new Error("Envie JSON para notas ou FormData para cardápios.");
  }
  const body: unknown = await readJsonBody(request);
  if (!isRecord(body)) throw new Error("Requisição inválida.");
  const importType = body.importType;
  if (importType !== "invoice" && importType !== "menu") {
    throw new Error("Selecione importação de nota fiscal ou cardápio.");
  }
  const text = stringValue(body.text);
  if (importType === "menu" && text) {
    if (text.length > 50_000) {
      throw new Error("O texto excede o limite de 50.000 caracteres.");
    }
    return { importType, text };
  }
  return {
    importType,
    mimeType: stringValue(body.mimeType),
    imageBase64: stringValue(body.imageBase64).replace(
      /^data:[^;]+;base64,/,
      "",
    ),
  };
}

function getSchema(type: ImportType) {
  if (type === "invoice") {
    return {
      type: "object",
      additionalProperties: false,
      properties: {
        fornecedor: { type: "string" },
        numeroNota: { type: "string" },
        dataEmissao: { type: "string" },
        itens: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              descricao: { type: "string" },
              quantidade: { type: "string" },
              unidade: { type: "string", enum: UNITS },
              valorUnitario: { type: "string" },
              valorTotal: { type: "string" },
              classificacao: { type: "string", enum: CLASSES },
            },
            required: [
              "descricao",
              "quantidade",
              "unidade",
              "valorUnitario",
              "valorTotal",
              "classificacao",
            ],
          },
        },
      },
      required: ["fornecedor", "numeroNota", "dataEmissao", "itens"],
    };
  }

  return {
    type: "object",
    additionalProperties: false,
    properties: {
      itens: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            nome: { type: "string" },
            preco: { type: "number" },
            categoria: { type: "string" },
          },
          required: ["nome", "preco", "categoria"],
        },
      },
    },
    required: ["itens"],
  };
}

function normalizeInvoiceItem(value: unknown) {
  const item = isRecord(value) ? value : {};
  const unit = stringValue(item.unidade);
  const classification = stringValue(item.classificacao);
  return {
    descricao: stringValue(item.descricao),
    quantidade: stringValue(item.quantidade),
    unidade: UNITS.includes(unit) ? unit : "",
    valorUnitario: stringValue(item.valorUnitario),
    valorTotal: stringValue(item.valorTotal),
    classificacao: CLASSES.includes(classification) ? classification : "",
  };
}

function normalizeMenuItems(
  value: unknown,
): Array<{ nome: string; preco: number; categoria: string }> {
  if (!Array.isArray(value)) {
    throw new Error("A resposta do Grok não contém uma lista de itens.");
  }
  if (value.length === 0) {
    throw new Error(
      "Nenhum prato e preço foi identificado. Envie uma foto mais nítida e enquadrada.",
    );
  }
  if (value.length > 300) {
    throw new Error("A imagem excede o limite de 300 itens por leitura.");
  }

  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`O item ${index + 1} veio em formato inválido.`);
    }
    const nome = stringValue(entry.nome);
    const categoria = stringValue(entry.categoria);
    const preco =
      typeof entry.preco === "number" ? entry.preco : Number.NaN;
    if (!nome || !categoria || !Number.isFinite(preco) || preco < 0) {
      throw new Error(
        `O item ${index + 1} não contém nome, categoria ou preço numérico válido.`,
      );
    }
    return { nome, preco, categoria };
  });
}

function safeErrorDetails(error: unknown, apiKey: string) {
  const value = isRecord(error) ? error : {};
  const nestedError = isRecord(value.error) ? value.error : {};
  let message =
    error instanceof Error
      ? error.message
      : typeof value.message === "string"
        ? value.message
        : typeof nestedError.message === "string"
          ? nestedError.message
          : "Erro desconhecido";
  let parsedMessage: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(message);
    if (isRecord(parsed)) parsedMessage = parsed;
  } catch {
    // Keep the original provider error message when it is not JSON.
  }
  const parsedError = isRecord(parsedMessage.error)
    ? parsedMessage.error
    : parsedMessage;
  if (typeof parsedError.message === "string") {
    message = parsedError.message;
  }
  const status =
    typeof value.status === "number" || typeof value.status === "string"
      ? value.status
      : typeof nestedError.status === "string"
        ? nestedError.status
        : typeof parsedError.status === "string" ||
            typeof parsedError.status === "number"
          ? parsedError.status
      : undefined;
  const code =
    typeof value.code === "string" || typeof value.code === "number"
      ? value.code
      : typeof nestedError.code === "number" || typeof nestedError.code === "string"
        ? nestedError.code
        : typeof parsedError.code === "number" ||
            typeof parsedError.code === "string"
          ? parsedError.code
      : undefined;
  return {
    status,
    code,
    message: message
      .replaceAll(apiKey, "[REDACTED]")
      .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
      .slice(0, 1000),
  };
}

function getXaiOutputText(response: unknown): string | undefined {
  if (!isRecord(response) || !Array.isArray(response.output)) return undefined;
  for (const outputItem of response.output) {
    if (!isRecord(outputItem) || outputItem.type !== "message") continue;
    if (!Array.isArray(outputItem.content)) continue;
    const text = outputItem.content.find(
      (content) =>
        isRecord(content) &&
        content.type === "output_text" &&
        typeof content.text === "string",
    );
    if (isRecord(text) && typeof text.text === "string") return text.text;
  }
  return undefined;
}

export async function POST(request: NextRequest) {
  let user: AuthenticatedUser | null;
  try {
    user = await authenticate(request);
  } catch {
    return NextResponse.json(
      { error: "Não foi possível verificar o perfil operacional." },
      { status: 503 },
    );
  }
  if (!user) {
    return NextResponse.json({ error: "Autenticação necessária." }, { status: 401 });
  }
  if (!["super_admin", "owner", "manager", "purchasing"].includes(user.role)) {
    return NextResponse.json(
      { error: "Seu perfil não pode usar a importação OCR." },
      { status: 403 },
    );
  }

  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Configure XAI_API_KEY no ambiente do servidor para usar o OCR." },
      { status: 503 },
    );
  }

  let input: OcrInput;
  try {
    input = await readOcrInput(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return NextResponse.json(
      {
        error: message.includes("máximo") || message.includes("limite")
          ? message
          : message || "Requisição de imagem inválida.",
      },
      { status: message.includes("máximo") || message.includes("limite") ? 413 : 400 },
    );
  }

  const { importType, mimeType, imageBase64, text } = input;
  let stage = text ? "preparação do texto" : "decodificação da imagem";
  try {
    let imageData: string | undefined;
    if (text) {
      if (importType !== "menu") {
        return NextResponse.json(
          { error: "O processamento por texto está disponível para cardápios." },
          { status: 400 },
        );
      }
    } else {
      if (!mimeType || !IMAGE_TYPES.has(mimeType)) {
        return NextResponse.json(
          { error: "Envie uma imagem JPEG ou PNG." },
          { status: 400 },
        );
      }
      if (!imageBase64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(imageBase64)) {
        return NextResponse.json(
          { error: "Imagem vazia ou em formato Base64 inválido." },
          { status: 400 },
        );
      }
      const imageBytes = Buffer.from(imageBase64, "base64");
      if (imageBytes.byteLength === 0 || imageBytes.byteLength > MAX_IMAGE_BYTES) {
        return NextResponse.json(
          { error: "Imagem vazia ou maior que o limite de 10 MB." },
          { status: 400 },
        );
      }
      imageData = imageBytes.toString("base64");
    }

    if (!text && !imageData) {
      return NextResponse.json(
        { error: "Envie uma imagem ou texto para processamento." },
        { status: 400 },
      );
    }

    const instruction =
      importType === "invoice"
        ? [
            "Extraia os dados visíveis desta nota fiscal brasileira e seus itens.",
            "Retorne somente dados lidos. Nunca invente nem estime informação; campos ausentes ou ilegíveis devem ser strings vazias.",
            "Use ponto decimal. Unidade deve ser kg, g, L, ml, unidade, pacote, caixa ou vazia.",
            "Classifique como insumo_producao somente matérias-primas ou ingredientes; material operacional, serviços e demais itens são compra_geral. Se houver dúvida, deixe classificação vazia para revisão humana.",
            "A data deve ser ISO YYYY-MM-DD quando legível, caso contrário vazia. Não calcule valores ausentes.",
          ].join(" ")
        : [
            text
              ? "Organize o texto bruto de um cardápio em produtos."
              : "Leia a imagem do cardápio e extraia todos os pratos, bebidas e produtos que tenham nome e preço visíveis.",
            "Retorne JSON estrito no formato {\"itens\":[{\"nome\":\"string\",\"preco\":number,\"categoria\":\"string\"}]}, sem Markdown ou texto adicional.",
            "O preço deve ser um número em reais, sem símbolo de moeda. Não estime nem invente nomes ou preços; ignore linhas sem nome ou preço legível.",
            "Use a categoria escrita no texto quando estiver explícita; caso contrário, agrupe por seção ou tipo de produto. Se não houver contexto suficiente, use \"Outros\".",
            text
              ? "O texto bruto pode separar produtos por vírgulas, pontos, quebras de linha ou pontuação de moeda; associe cada preço ao produto imediatamente correspondente."
              : "Leia todas as colunas e seções, mantendo a ordem visual de cima para baixo e da esquerda para a direita.",
          ].join(" ");

    stage = "chamada ao Grok";
    const userContent: Array<Record<string, string>> = [];
    if (imageData && mimeType) {
      userContent.push({
        type: "input_image",
        image_url: `data:${mimeType};base64,${imageData}`,
        detail: "high",
      });
    }
    userContent.push({
      type: "input_text",
      text: text
        ? `${instruction}\n\nTexto bruto do cardápio:\n${text}`
        : instruction,
    });

    const xaiResponse = await fetch("https://api.x.ai/v1/responses", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.XAI_MODEL || "grok-4.7",
        instructions:
          "Extraia informações exclusivamente da imagem ou texto fornecido. Não invente nem estime dados ausentes.",
        input: [{ role: "user", content: userContent }],
        text: {
          format: {
            type: "json_schema",
            name: "ocr_result",
            schema: getSchema(importType),
            strict: true,
          },
        },
        store: false,
        max_output_tokens: 16000,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(90_000),
    });
    const providerBody = await xaiResponse.text();
    let providerResult: unknown;
    try {
      providerResult = JSON.parse(providerBody) as unknown;
    } catch {
      throw new Error(
        JSON.stringify({
          error: {
            status: xaiResponse.status,
            message: `A API xAI retornou uma resposta não JSON (HTTP ${xaiResponse.status}).`,
          },
        }),
      );
    }
    if (!xaiResponse.ok) {
      const providerError =
        isRecord(providerResult) && isRecord(providerResult.error)
          ? providerResult.error
          : {};
      throw new Error(
        JSON.stringify({
          error: {
            status: xaiResponse.status,
            code: providerError.code,
            message:
              typeof providerError.message === "string"
                ? providerError.message
                : `A API xAI rejeitou a solicitação (HTTP ${xaiResponse.status}).`,
          },
        }),
      );
    }

    stage = "validação da resposta do Grok";
    const responseText = getXaiOutputText(providerResult)?.trim();
    if (!responseText) {
      throw new Error("O Grok retornou uma resposta vazia ou incompleta.");
    }
    const extracted: unknown = JSON.parse(responseText);
    if (!isRecord(extracted)) {
      throw new Error("O Grok retornou JSON em formato inválido.");
    }
    const rawItems = Array.isArray(extracted.itens) ? extracted.itens : [];
    if (rawItems.length > 300) {
      return NextResponse.json(
        { error: "A imagem excede o limite de 300 itens por leitura." },
        { status: 422 },
      );
    }
    if (importType === "invoice") {
      return NextResponse.json({
        importType,
        fornecedor: stringValue(extracted.fornecedor),
        numeroNota: stringValue(extracted.numeroNota),
        dataEmissao: stringValue(extracted.dataEmissao),
        itens: rawItems.map(normalizeInvoiceItem),
      });
    }
    const itens = normalizeMenuItems(rawItems);
    return NextResponse.json({ importType, itens });
  } catch (error) {
    const details = safeErrorDetails(error, apiKey);
    console.error("Grok OCR processing failed", {
      importType,
      source: text ? "text" : "image",
      stage,
      ...details,
      stack: error instanceof Error ? error.stack?.slice(0, 2000) : undefined,
    });
    return NextResponse.json(
      {
        error: "A leitura automática falhou. Você pode preencher os itens manualmente.",
        diagnostic: details,
        canContinueManually: true,
      },
      { status: 502 },
    );
  }
}
