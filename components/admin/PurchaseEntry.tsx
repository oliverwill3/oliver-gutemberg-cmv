"use client";

import Image from "next/image";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  confirmarCompra,
  importarItensCardapio,
  type ItemCardapioInput,
  type NotaImportacaoInput,
} from "@/lib/firestore/compras";
import { getFirebaseServices } from "@/lib/firebase";
import type {
  ClassificacaoCompraItem,
  Compra,
  Insumo,
  ItemCompra,
  UnidadeMedida,
} from "@/types";

type ImportType = "invoice" | "menu";

interface DraftItem {
  nomeProduto: string;
  descricao: string;
  quantidade: string;
  unidade: string;
  preco: string;
  categoria: string;
  classificacao: string;
  insumoId: string;
  valorUnitario: string;
  valorTotal: string;
}

interface ImportData {
  fornecedor: string;
  numeroNota: string;
  dataEmissao: string;
  itens: DraftItem[];
}

interface OcrResponse {
  importType: ImportType;
  fornecedor?: string;
  numeroNota?: string;
  dataEmissao?: string;
  itens: Array<Record<string, unknown>>;
  diagnostic?: {
    status?: string | number;
    code?: string | number;
    message?: string;
  };
}

const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const units: UnidadeMedida[] = [
  "kg",
  "g",
  "L",
  "ml",
  "unidade",
  "pacote",
  "caixa",
];
const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function subscribeToLocation(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
}

function getImportTypeFromUrl(): ImportType {
  return new URLSearchParams(window.location.search).get("tipo") === "cardapio"
    ? "menu"
    : "invoice";
}

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : "Ocorreu um erro inesperado.";
}

function stringValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function parseNumber(value: string): number | null {
  const cleaned = value.trim().replace(/[^\d,.-]/g, "");
  if (!cleaned) return null;
  let normalized = cleaned;
  const comma = cleaned.lastIndexOf(",");
  const dot = cleaned.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    normalized =
      comma > dot
        ? cleaned.replace(/\./g, "").replace(",", ".")
        : cleaned.replace(/,/g, "");
  } else if (comma >= 0) {
    normalized = cleaned.replace(",", ".");
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatInputDate(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const brazilian = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return brazilian ? `${brazilian[3]}-${brazilian[2]}-${brazilian[1]}` : "";
}

function toBase64(bytes: ArrayBuffer): string {
  const data = new Uint8Array(bytes);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < data.length; offset += chunkSize) {
    binary += String.fromCharCode(...data.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

async function toProviderImage(file: File): Promise<File> {
  if (file.type !== "image/webp") return file;
  const image = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Não foi possível converter a imagem WebP.");
    context.drawImage(image, 0, 0);
    const png = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Não foi possível converter a imagem WebP."));
      }, "image/png");
    });
    if (png.size > MAX_IMAGE_SIZE) {
      throw new Error("A imagem convertida excede o limite de 10 MB.");
    }
    return new File(
      [png],
      file.name.replace(/\.webp$/i, ".png"),
      { type: "image/png" },
    );
  } finally {
    image.close();
  }
}

function emptyImport(): ImportData {
  return { fornecedor: "", numeroNota: "", dataEmissao: "", itens: [] };
}

function toDraftItem(
  item: Record<string, unknown>,
  type: ImportType,
): DraftItem {
  if (type === "invoice") {
    const rawClass = stringValue(item.classificacao);
    return {
      nomeProduto: "",
      descricao: stringValue(item.descricao),
      quantidade: stringValue(item.quantidade),
      unidade: stringValue(item.unidade),
      preco: "",
      categoria: "",
      classificacao:
        rawClass === "insumo_producao" || rawClass === "compra_geral"
          ? rawClass
          : "",
      insumoId: "",
      valorUnitario: stringValue(item.valorUnitario),
      valorTotal: stringValue(item.valorTotal),
    };
  }
  return {
    nomeProduto: stringValue(item.nomeProduto ?? item.nome),
    descricao: stringValue(item.descricao),
    quantidade: stringValue(item.quantidade),
    unidade: stringValue(item.unidade),
    preco: stringValue(item.preco),
    categoria: stringValue(item.categoria),
    classificacao: "",
    insumoId: "",
    valorUnitario: "",
    valorTotal: "",
  };
}

function invoiceItem(item: DraftItem): ItemCompra {
  return {
    descricao: item.descricao.trim(),
    quantidade: parseNumber(item.quantidade),
    unidade: units.includes(item.unidade as UnidadeMedida)
      ? (item.unidade as UnidadeMedida)
      : "",
    valorUnitario: parseNumber(item.valorUnitario),
    valorTotal: parseNumber(item.valorTotal),
    classificacao:
      item.classificacao === "insumo_producao" ||
      item.classificacao === "compra_geral"
        ? (item.classificacao as ClassificacaoCompraItem)
        : "",
    insumoId: item.insumoId,
  };
}

function menuItem(item: DraftItem): ItemCardapioInput {
  return {
    nomeProduto: item.nomeProduto.trim(),
    descricao: item.descricao.trim(),
    quantidade: parseNumber(item.quantidade),
    unidade: units.includes(item.unidade as UnidadeMedida)
      ? (item.unidade as UnidadeMedida)
      : "",
    preco: parseNumber(item.preco),
    categoria: item.categoria.trim(),
  };
}

function HistoryList({ purchases }: { purchases: Compra[] }) {
  if (purchases.length === 0) {
    return (
      <div className="empty-state">
        As notas importadas e confirmadas aparecerão aqui.
      </div>
    );
  }
  return (
    <div className="purchase-history">
      {purchases.map((purchase) => (
        <details className="purchase-history-item" key={purchase.id}>
          <summary>
            <span>
              <strong>{purchase.fornecedor || purchase.nomeArquivo}</strong>
              <small>
                {purchase.numeroNota ? `Nota ${purchase.numeroNota} · ` : ""}
                {purchase.dataEmissao ||
                  new Date(purchase.criadaEm).toLocaleDateString("pt-BR")}
              </small>
            </span>
            <span className="purchase-history-right">
              <strong>{currency.format(purchase.totalCompra || 0)}</strong>
              <span className="purchase-status confirmed">Confirmada</span>
            </span>
          </summary>
          <div className="purchase-history-details">
            {purchase.itens?.length ? (
              <ul>
                {purchase.itens.map((item, index) => (
                  <li key={`${purchase.id}-${index}`}>
                    {item.descricao} ·{" "}
                    {item.classificacao === "insumo_producao"
                      ? "Produção"
                      : "Compra geral"}{" "}
                    · {currency.format(item.valorTotal ?? 0)}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </details>
      ))}
    </div>
  );
}

export function PurchaseEntry({
  storeId,
  usuarioId,
  insumos,
  purchases,
}: {
  storeId: string;
  usuarioId: string;
  insumos: Insumo[];
  purchases: Compra[];
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const importType = useSyncExternalStore(
    subscribeToLocation,
    getImportTypeFromUrl,
    (): ImportType => "invoice",
  );
  const [activeType, setActiveType] = useState<ImportType>(importType);
  const [filename, setFilename] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [rawMenuText, setRawMenuText] = useState("");
  const [hasReview, setHasReview] = useState(false);
  const [data, setData] = useState<ImportData>(emptyImport);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [ocrFailed, setOcrFailed] = useState(false);

  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  function resetImport() {
    setFilename("");
    setPreviewUrl("");
    setRawMenuText("");
    setHasReview(false);
    setData(emptyImport());
    setError("");
    setNotice("");
    setOcrFailed(false);
    if (fileInput.current) fileInput.current.value = "";
  }

  function updateHeader(patch: Partial<Omit<ImportData, "itens">>) {
    setData((current) => ({ ...current, ...patch }));
  }

  function updateItem(index: number, patch: Partial<DraftItem>) {
    setData((current) => ({
      ...current,
      itens: current.itens.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    }));
  }

  function addItem() {
    setData((current) => ({
      ...current,
      itens: [
        ...current.itens,
        {
          nomeProduto: "",
          descricao: "",
          quantidade: "",
          unidade: "",
          preco: "",
          categoria: "",
          classificacao: "",
          insumoId: "",
          valorUnitario: "",
          valorTotal: "",
        },
      ],
    }));
  }

  function removeItem(index: number) {
    setData((current) => ({
      ...current,
      itens: current.itens.filter((_, itemIndex) => itemIndex !== index),
    }));
  }

  async function handleFile(file?: File) {
    if (!file) return;
    setError("");
    setNotice("");
    if (!allowedTypes.has(file.type)) {
      setError("Envie uma imagem JPEG, PNG ou WebP.");
      return;
    }
    if (file.size > MAX_IMAGE_SIZE) {
      setError("A imagem deve ter no máximo 10 MB.");
      return;
    }

    setFilename(file.name);
    setPreviewUrl(URL.createObjectURL(file));
    setHasReview(true);
    setData(emptyImport());
    setOcrFailed(false);
    setBusy(true);
    try {
      const { auth } = getFirebaseServices();
      const user = auth.currentUser;
      if (!user || user.uid !== usuarioId) {
        throw new Error("Sua sessão expirou. Entre novamente para continuar.");
      }
      const providerImage = await toProviderImage(file);
      const headers = new Headers({
        Authorization: `Bearer ${await user.getIdToken()}`,
      });
      let requestBody: BodyInit;
      if (activeType === "menu") {
        const formData = new FormData();
        formData.append("importType", "menu");
        formData.append("image", providerImage, providerImage.name);
        requestBody = formData;
      } else {
        headers.set("Content-Type", "application/json");
        requestBody = JSON.stringify({
          importType: activeType,
          mimeType: providerImage.type,
          imageBase64: toBase64(await providerImage.arrayBuffer()),
        });
      }
      const response = await fetch("/api/ocr", {
        method: "POST",
        headers,
        body: requestBody,
      });
      const responseText = await response.text();
      let result: unknown;
      try {
        result = JSON.parse(responseText) as unknown;
      } catch {
        console.error("OCR API returned a non-JSON response", {
          status: response.status,
          contentType: response.headers.get("content-type"),
          response: responseText.slice(0, 1500),
        });
        throw new Error(
          `A API de OCR respondeu em formato inválido (HTTP ${response.status}).`,
        );
      }
      if (!response.ok) {
        console.error("OCR API request failed", {
          status: response.status,
          importType: activeType,
          response: result,
        });
        const apiResponse =
          typeof result === "object" && result !== null
            ? (result as Partial<OcrResponse> & { error?: string })
            : {};
        const apiError =
          typeof apiResponse.error === "string"
            ? apiResponse.error
            : "O OCR não conseguiu ler a imagem.";
        const diagnostic = apiResponse.diagnostic;
        const diagnosticMessage =
          diagnostic && typeof diagnostic.message === "string"
            ? ` Detalhe: ${diagnostic.message}`
            : "";
        const diagnosticStatus =
          diagnostic?.status !== undefined
            ? ` (HTTP ${response.status}, status do provedor ${diagnostic.status})`
            : ` (HTTP ${response.status})`;
        throw new Error(`${apiError}${diagnosticStatus}${diagnosticMessage}`);
      }
      if (
        typeof result !== "object" ||
        result === null ||
        !("itens" in result) ||
        !Array.isArray(result.itens)
      ) {
        throw new Error("A resposta do OCR está em um formato inválido.");
      }

      const extracted = result as OcrResponse;
      if (extracted.importType !== activeType) {
        throw new Error("O resultado não corresponde ao tipo de importação selecionado.");
      }
      if (extracted.itens.length === 0) {
        console.error("OCR API returned no extracted items", {
          status: response.status,
          importType: activeType,
          response: result,
        });
        throw new Error(
          "A IA não identificou nenhum item. Tente uma foto mais nítida, aproximada e bem iluminada.",
        );
      }
      console.info("OCR API extraction completed", {
        status: response.status,
        importType: activeType,
        itemCount: extracted.itens.length,
      });
      setData({
        fornecedor: extracted.fornecedor ?? "",
        numeroNota: extracted.numeroNota ?? "",
        dataEmissao: formatInputDate(extracted.dataEmissao ?? ""),
        itens: extracted.itens.map((item) =>
          toDraftItem(
            activeType === "menu"
              ? { nomeProduto: item.nome, preco: item.preco }
              : item,
            activeType,
          ),
        ),
      });
      setNotice(
        extracted.itens.length
          ? "Revise todos os campos. Nada foi salvo no Firestore ainda."
          : "Nenhum item foi identificado. Adicione e preencha as linhas manualmente.",
      );
    } catch (ocrError) {
      console.error("OCR upload or extraction failed", {
        importType: activeType,
        message: messageFrom(ocrError),
      });
      setOcrFailed(true);
      setError(messageFrom(ocrError));
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function processMenuText() {
    const text = rawMenuText.trim();
    if (!text) {
      setError("Cole ou digite os itens do cardápio antes de processar.");
      return;
    }

    setError("");
    setNotice("");
    setOcrFailed(false);
    setBusy(true);
    setFilename("Texto fornecido");
    setPreviewUrl("");
    setHasReview(true);
    setData(emptyImport());

    try {
      const { auth } = getFirebaseServices();
      const user = auth.currentUser;
      if (!user || user.uid !== usuarioId) {
        throw new Error("Sua sessão expirou. Entre novamente para continuar.");
      }

      const response = await fetch("/api/ocr", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${await user.getIdToken()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ importType: "menu", text }),
      });
      const responseText = await response.text();
      let result: unknown;
      try {
        result = JSON.parse(responseText) as unknown;
      } catch {
        console.error("OCR text API returned a non-JSON response", {
          status: response.status,
          contentType: response.headers.get("content-type"),
          response: responseText.slice(0, 1500),
        });
        throw new Error(
          `A API de texto respondeu em formato inválido (HTTP ${response.status}).`,
        );
      }
      if (!response.ok) {
        const apiResponse =
          typeof result === "object" && result !== null
            ? (result as Partial<OcrResponse> & { error?: string })
            : {};
        const diagnostic = apiResponse.diagnostic;
        const detail =
          diagnostic && typeof diagnostic.message === "string"
            ? ` Detalhe: ${diagnostic.message}`
            : "";
        console.error("OCR text API request failed", {
          status: response.status,
          response: result,
        });
        throw new Error(
          `${apiResponse.error || "A IA não conseguiu processar o texto."} (HTTP ${response.status})${detail}`,
        );
      }
      if (
        typeof result !== "object" ||
        result === null ||
        !("itens" in result) ||
        !Array.isArray(result.itens)
      ) {
        throw new Error("A resposta do processamento de texto está inválida.");
      }

      const extracted = result as OcrResponse;
      if (extracted.importType !== "menu" || extracted.itens.length === 0) {
        throw new Error(
          "A IA não encontrou produtos. Verifique o texto e tente novamente.",
        );
      }
      setData({
        fornecedor: "",
        numeroNota: "",
        dataEmissao: "",
        itens: extracted.itens.map((item) => toDraftItem(item, "menu")),
      });
      setNotice("Texto processado. Revise nome, preço e categoria antes de salvar.");
      console.info("OCR text extraction completed", {
        status: response.status,
        itemCount: extracted.itens.length,
      });
    } catch (processingError) {
      console.error("OCR text processing failed", {
        message: messageFrom(processingError),
      });
      setOcrFailed(true);
      setError(messageFrom(processingError));
    } finally {
      setBusy(false);
    }
  }

  async function confirmImport() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (data.itens.length === 0) {
        throw new Error("Adicione ao menos um item antes de confirmar.");
      }
      if (activeType === "invoice") {
        const input: NotaImportacaoInput = {
          fornecedor: data.fornecedor,
          numeroNota: data.numeroNota,
          dataEmissao: data.dataEmissao,
          nomeArquivo: filename || "Lançamento manual",
          itens: data.itens.map(invoiceItem),
        };
        await confirmarCompra(storeId, input);
        setNotice("Nota confirmada. Estoque e fichas impactadas foram atualizados.");
      } else {
        await importarItensCardapio(
          storeId,
          usuarioId,
          data.itens.map(menuItem),
        );
        setNotice("Produtos importados para a coleção items e salvos para revisão.");
      }
      setFilename("");
      setPreviewUrl("");
      setHasReview(false);
      setData(emptyImport());
      setRawMenuText("");
    } catch (saveError) {
      setError(messageFrom(saveError));
    } finally {
      setBusy(false);
    }
  }

  const total = data.itens.reduce((sum, item) => {
    return (
      sum +
      (activeType === "invoice"
        ? (parseNumber(item.valorTotal) ?? 0)
        : (parseNumber(item.preco) ?? 0))
    );
  }, 0);

  return (
    <div className="purchase-entry">
      {error ? <div className="notice error">{error}</div> : null}
      {ocrFailed ? (
        <div className="field-hint" role="status">
          O arquivo foi recebido, mas a extração automática não terminou. Você
          pode corrigir o problema e reenviar ou continuar preenchendo os itens
          manualmente.
        </div>
      ) : null}
      {notice ? <div className="notice success">{notice}</div> : null}

      <section className="panel ocr-upload-panel">
        <div className="panel-body">
          <div className="eyebrow">Importação OCR · Grok</div>
          <h2 className="purchase-upload-title">
            Importar {activeType === "invoice" ? "nota fiscal" : "cardápio"}
          </h2>
          <p className="page-subtitle">
            A imagem é processada temporariamente no servidor. Nenhum arquivo é
            enviado ao Firebase Storage.
          </p>
          <div aria-label="Tipo de documento" className="target-options">
            <button
              aria-pressed={activeType === "invoice"}
              className={`category-chip${activeType === "invoice" ? " selected" : ""}`}
              disabled={busy}
              onClick={() => {
                setActiveType("invoice");
                resetImport();
              }}
              type="button"
            >
              Nota fiscal
            </button>
            <button
              aria-pressed={activeType === "menu"}
              className={`category-chip${activeType === "menu" ? " selected" : ""}`}
              disabled={busy}
              onClick={() => {
                setActiveType("menu");
                resetImport();
              }}
              type="button"
            >
              Cardápio
            </button>
          </div>
          <input
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            className="visually-hidden"
            onChange={(event) => void handleFile(event.target.files?.[0])}
            ref={fileInput}
            type="file"
          />
          <button
            className="button button-primary"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
            type="button"
          >
            {busy ? "Analisando imagem…" : "Selecionar imagem ou usar câmera"}
          </button>
          <span className="field-hint">JPEG, PNG ou WebP · até 10 MB</span>
          {filename ? <span className="field-hint">Arquivo: {filename}</span> : null}
          {activeType === "menu" ? (
            <div className="menu-text-import">
              <div className="field full">
                <label htmlFor="raw-menu-text">Ou cole/digite o texto do cardápio</label>
                <textarea
                  disabled={busy}
                  id="raw-menu-text"
                  onChange={(event) => setRawMenuText(event.target.value)}
                  placeholder="Ex.: Pratos: Filé Parmegiana R$ 45, Suco de Laranja R$ 8"
                  rows={5}
                  value={rawMenuText}
                />
              </div>
              <button
                className="button button-secondary"
                disabled={busy || !rawMenuText.trim()}
                onClick={() => void processMenuText()}
                type="button"
              >
                {busy ? "Processando texto…" : "Processar texto com IA"}
              </button>
            </div>
          ) : null}
        </div>
      </section>

      {busy ? (
        <div aria-live="polite" className="panel loading-state">
          Enviando imagem ao Grok e estruturando os dados…
        </div>
      ) : null}

      {hasReview ? (
        <div className="purchase-split-view">
          {previewUrl ? (
            <section className="panel invoice-preview">
              <div className="panel-header">
                <h2 className="panel-title">Pré-visualização</h2>
              </div>
              <div className="invoice-image-stage">
                <Image
                  alt={`Pré-visualização de ${filename}`}
                  className="invoice-image"
                  fill
                  sizes="(max-width: 760px) 100vw, 45vw"
                  src={previewUrl}
                  unoptimized
                />
              </div>
            </section>
          ) : null}

          <section className="panel invoice-fields">
            <div className="panel-header">
              <h2 className="panel-title">
                Dados extraídos · editáveis
              </h2>
              <span className="status">
                {data.itens.length} {data.itens.length === 1 ? "item" : "itens"}
              </span>
            </div>
            <div className="panel-body">
              {activeType === "invoice" ? (
                <div className="form-grid invoice-header-fields">
                  <div className="field">
                    <label htmlFor="invoice-supplier">Fornecedor</label>
                    <input
                      id="invoice-supplier"
                      onChange={(event) =>
                        updateHeader({ fornecedor: event.target.value })
                      }
                      value={data.fornecedor}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="invoice-number">Número da nota</label>
                    <input
                      id="invoice-number"
                      onChange={(event) =>
                        updateHeader({ numeroNota: event.target.value })
                      }
                      value={data.numeroNota}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="invoice-date">Data de emissão</label>
                    <input
                      id="invoice-date"
                      onChange={(event) =>
                        updateHeader({ dataEmissao: event.target.value })
                      }
                      type="date"
                      value={data.dataEmissao}
                    />
                  </div>
                </div>
              ) : null}

              <div className="invoice-lines-heading">
                <h3>Itens extraídos</h3>
                <button
                  className="button button-secondary"
                  disabled={busy}
                  onClick={addItem}
                  type="button"
                >
                  + Adicionar item
                </button>
              </div>

              {data.itens.length === 0 ? (
                <div className="empty-state">
                  {ocrFailed
                    ? "A leitura por IA falhou e nenhum item foi extraído. Veja o erro acima; se desejar, use “Adicionar item” para continuar manualmente."
                    : "Nenhum item identificado. Adicione as linhas manualmente."}
                </div>
              ) : (
                <>
                  {activeType === "menu" ? (
                    <div className="table-wrap">
                      <table className="data-table menu-review-table">
                        <thead>
                          <tr>
                            <th>Produto</th>
                            <th>Preço (R$)</th>
                            <th>Categoria</th>
                            <th>Ação</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.itens.map((item, index) => (
                            <tr key={index}>
                              <td>
                                <input
                                  aria-label={`Nome do produto ${index + 1}`}
                                  onChange={(event) =>
                                    updateItem(index, { nomeProduto: event.target.value })
                                  }
                                  value={item.nomeProduto}
                                />
                              </td>
                              <td>
                                <input
                                  aria-label={`Preço do produto ${index + 1}`}
                                  inputMode="decimal"
                                  onChange={(event) =>
                                    updateItem(index, { preco: event.target.value })
                                  }
                                  value={item.preco}
                                />
                              </td>
                              <td>
                                <input
                                  aria-label={`Categoria do produto ${index + 1}`}
                                  onChange={(event) =>
                                    updateItem(index, { categoria: event.target.value })
                                  }
                                  value={item.categoria}
                                />
                              </td>
                              <td>
                                <button
                                  className="icon-button"
                                  disabled={busy}
                                  onClick={() => removeItem(index)}
                                  type="button"
                                >
                                  Remover
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                  {activeType === "invoice" ? (
                    <div className="invoice-item-list">
                  {data.itens.map((item, index) => (
                    <article className="invoice-item-card" key={index}>
                      <div className="invoice-item-card-heading">
                        <span>Item {index + 1}</span>
                        <button
                          className="icon-button"
                          disabled={busy}
                          onClick={() => removeItem(index)}
                          type="button"
                        >
                          Remover
                        </button>
                      </div>

                      {activeType === "invoice" ? (
                        <div className="form-grid invoice-item-fields">
                          <div className="field full">
                            <label htmlFor={`invoice-description-${index}`}>
                              Descrição
                            </label>
                            <input
                              id={`invoice-description-${index}`}
                              onChange={(event) =>
                                updateItem(index, { descricao: event.target.value })
                              }
                              value={item.descricao}
                            />
                          </div>
                          <div className="field">
                            <label htmlFor={`invoice-quantity-${index}`}>
                              Quantidade
                            </label>
                            <input
                              id={`invoice-quantity-${index}`}
                              inputMode="decimal"
                              onChange={(event) =>
                                updateItem(index, { quantidade: event.target.value })
                              }
                              value={item.quantidade}
                            />
                          </div>
                          <div className="field">
                            <label htmlFor={`invoice-unit-${index}`}>Unidade</label>
                            <select
                              id={`invoice-unit-${index}`}
                              onChange={(event) =>
                                updateItem(index, { unidade: event.target.value })
                              }
                              value={item.unidade}
                            >
                              <option value="">Não identificada</option>
                              {units.map((unit) => (
                                <option key={unit} value={unit}>
                                  {unit}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="field">
                            <label htmlFor={`invoice-price-${index}`}>
                              Valor unitário (R$)
                            </label>
                            <input
                              id={`invoice-price-${index}`}
                              inputMode="decimal"
                              onChange={(event) =>
                                updateItem(index, {
                                  valorUnitario: event.target.value,
                                })
                              }
                              value={item.valorUnitario}
                            />
                          </div>
                          <div className="field">
                            <label htmlFor={`invoice-total-${index}`}>
                              Valor total (R$)
                            </label>
                            <input
                              id={`invoice-total-${index}`}
                              inputMode="decimal"
                              onChange={(event) =>
                                updateItem(index, { valorTotal: event.target.value })
                              }
                              value={item.valorTotal}
                            />
                          </div>
                          <div className="field full">
                            <label htmlFor={`invoice-class-${index}`}>
                              Classificação obrigatória
                            </label>
                            <select
                              id={`invoice-class-${index}`}
                              onChange={(event) =>
                                updateItem(index, {
                                  classificacao: event.target.value,
                                  insumoId:
                                    event.target.value === "insumo_producao"
                                      ? item.insumoId
                                      : "",
                                })
                              }
                              required
                              value={item.classificacao}
                            >
                              <option value="">Selecione</option>
                              <option value="insumo_producao">
                                Insumo de produção · atualiza estoque e CMV
                              </option>
                              <option value="compra_geral">
                                Compra geral · apenas histórico
                              </option>
                            </select>
                          </div>
                          {item.classificacao === "insumo_producao" ? (
                            <div className="field full">
                              <label htmlFor={`invoice-ingredient-${index}`}>
                                Vincular insumo
                              </label>
                              <select
                                id={`invoice-ingredient-${index}`}
                                onChange={(event) =>
                                  updateItem(index, { insumoId: event.target.value })
                                }
                                required
                                value={item.insumoId}
                              >
                                <option value="">Selecione do estoque</option>
                                {insumos.map((ingredient) => (
                                  <option key={ingredient.id} value={ingredient.id}>
                                    {ingredient.nome} · {ingredient.unidade}
                                  </option>
                                ))}
                              </select>
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <div className="form-grid invoice-item-fields">
                          <div className="field full">
                            <label htmlFor={`menu-name-${index}`}>Nome do produto</label>
                            <input
                              id={`menu-name-${index}`}
                              onChange={(event) =>
                                updateItem(index, { nomeProduto: event.target.value })
                              }
                              value={item.nomeProduto}
                            />
                          </div>
                          <div className="field full">
                            <label htmlFor={`menu-description-${index}`}>Descrição</label>
                            <input
                              id={`menu-description-${index}`}
                              onChange={(event) =>
                                updateItem(index, { descricao: event.target.value })
                              }
                              value={item.descricao}
                            />
                          </div>
                          <div className="field">
                            <label htmlFor={`menu-quantity-${index}`}>Quantidade</label>
                            <input
                              id={`menu-quantity-${index}`}
                              inputMode="decimal"
                              onChange={(event) =>
                                updateItem(index, { quantidade: event.target.value })
                              }
                              value={item.quantidade}
                            />
                          </div>
                          <div className="field">
                            <label htmlFor={`menu-unit-${index}`}>Unidade</label>
                            <select
                              id={`menu-unit-${index}`}
                              onChange={(event) =>
                                updateItem(index, { unidade: event.target.value })
                              }
                              value={item.unidade}
                            >
                              <option value="">Não identificada</option>
                              {units.map((unit) => (
                                <option key={unit} value={unit}>
                                  {unit}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="field">
                            <label htmlFor={`menu-price-${index}`}>Preço (R$)</label>
                            <input
                              id={`menu-price-${index}`}
                              inputMode="decimal"
                              onChange={(event) =>
                                updateItem(index, { preco: event.target.value })
                              }
                              value={item.preco}
                            />
                          </div>
                          <div className="field">
                            <label htmlFor={`menu-category-${index}`}>Categoria</label>
                            <input
                              id={`menu-category-${index}`}
                              onChange={(event) =>
                                updateItem(index, { categoria: event.target.value })
                              }
                              value={item.categoria}
                            />
                          </div>
                        </div>
                      )}
                    </article>
                  ))}
                    </div>
                  ) : null}
                </>
              )}

              <div className="invoice-total">
                <span>{activeType === "invoice" ? "Total da nota" : "Soma dos preços"}</span>
                <strong>{currency.format(total)}</strong>
              </div>
              <div className="invoice-review-actions">
                <button
                  className="button button-secondary"
                  disabled={busy}
                  onClick={resetImport}
                  type="button"
                >
                  Descartar
                </button>
                <button
                  className="button button-primary"
                  disabled={busy || data.itens.length === 0}
                  onClick={() => void confirmImport()}
                  type="button"
                >
                  {busy ? "Salvando…" : "Confirmar e salvar"}
                </button>
              </div>
              <p className="field-hint invoice-confirm-hint">
                {activeType === "invoice"
                  ? "Itens de produção atualizam estoque, custo e fichas vinculadas. Compras gerais entram apenas no histórico."
                  : "Os produtos serão salvos em items para revisão; a importação não publica automaticamente no cardápio."}
              </p>
            </div>
          </section>
        </div>
      ) : null}

      {activeType === "invoice" ? (
        <section className="panel purchase-history-panel">
          <div className="panel-header">
            <h2 className="panel-title">Histórico de notas fiscais</h2>
            <span className="status">{purchases.length} registros</span>
          </div>
          <HistoryList purchases={purchases} />
        </section>
      ) : null}
    </div>
  );
}
