export type UnidadeMedida =
  | "kg"
  | "g"
  | "L"
  | "ml"
  | "unidade"
  | "pacote"
  | "caixa";

export interface Insumo {
  id: string;
  nome: string;
  categoria: string;
  unidade: UnidadeMedida;
  quantidadeCompra: number;
  precoCompra: number;
  fatorCorrecao: number;
  custoUnitario: number;
  quantidadeEstoque?: number;
  estoqueMinimo?: number;
  fichasTecnicasIds?: string[];
  fornecedor?: string;
  atualizadoEm: string;
}

export type UserRole =
  | "super_admin"
  | "owner"
  | "manager"
  | "purchasing"
  | "kitchen_bar";

export interface UserProfile {
  uid: string;
  role: UserRole;
  storeId: string;
}

export type PurchaseListItemStatus =
  | "requested"
  | "pending_approval"
  | "approved"
  | "rejected";

export interface PurchaseListItem {
  id: string;
  nome: string;
  quantidade: number;
  unidade: UnidadeCompraItem;
  categoria: string;
  insumoId: string;
  novoItem: boolean;
  origem: "manual" | "automatico";
  status: PurchaseListItemStatus;
  observacao: string;
  criadoPor: string;
  criadoPorEmail: string;
  criadoEm: string;
  revisadoPor?: string;
  revisadoPorEmail?: string;
  revisadoEm?: string;
  decisao?: string;
}

export interface ItemFichaTecnica {
  insumoId: string;
  insumoNome: string;
  quantidade: number;
  unidade: UnidadeMedida;
  custoUnitario: number;
  custoTotal: number;
}

export interface FichaTecnica {
  id: string;
  produtoId: string;
  nome: string;
  rendimento: number;
  itens: ItemFichaTecnica[];
  custoTotal: number;
  tipoMeta: "cmv" | "margem";
  percentualMeta: number;
  precoVenda: number;
  custoPorPorcao: number;
  precoSugerido: number;
  atualizadoEm: string;
}

export type TipoMetaPrecificacao = "cmv" | "margem";

export interface Produto {
  id: string;
  nome: string;
  descricao: string;
  categoriaId: string;
  categoriaNome: string;
  preco: number;
  disponivel: boolean;
  imagemUrl?: string;
  fichaTecnicaId?: string;
  destaque?: boolean;
  ordem?: number;
  atualizadoEm: string;
}

export interface CustoProduto {
  id: string;
  produtoId: string;
  custoFicha: number;
  cmvAtual: number;
  cmvAlvo: number;
  margemAtual: number;
  margemAlvo: number;
  precoSugerido: number;
  atualizadoEm: string;
}

export interface Categoria {
  id: string;
  nome: string;
  ordem: number;
  ativa: boolean;
}

export type ClassificacaoCompraItem = "insumo_producao" | "compra_geral";
export type UnidadeCompraItem = UnidadeMedida | "";

export interface ItemCompra {
  descricao: string;
  quantidade: number | null;
  unidade: UnidadeCompraItem;
  valorUnitario: number | null;
  valorTotal: number | null;
  classificacao: ClassificacaoCompraItem | "";
  insumoId: string;
}

export type StatusCompra =
  | "enviando"
  | "em_revisao"
  | "confirmada"
  | "falha_upload";

export interface Compra {
  id: string;
  status: StatusCompra;
  nomeArquivo: string;
  storagePath?: string;
  downloadURL?: string;
  fornecedor: string;
  numeroNota: string;
  dataEmissao: string;
  itens: ItemCompra[];
  totalCompra: number;
  erroOcr?: string;
  erroUpload?: string;
  criadaEm: string;
  confirmadaEm?: string;
  usuarioId: string;
}

export interface ItemCardapioImportado {
  id: string;
  nomeProduto: string;
  descricao: string;
  quantidade: number | null;
  unidade: UnidadeCompraItem;
  preco: number | null;
  categoria: string;
  importadoEm: string;
  usuarioId: string;
}

export interface NotaImportada {
  id: string;
  fornecedor: string;
  numeroNota: string;
  dataEmissao: string;
  itens: ItemCompra[];
  totalCompra: number;
  nomeArquivo: string;
  criadaEm: string;
  usuarioId: string;
}
