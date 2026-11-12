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
  storeId: string;
  nome: string;
  categoria: string;
  unidade: UnidadeMedida;
  quantidadeCompra?: number;
  precoCompra?: number;
  fatorCorrecao?: number;
  custoUnitario?: number;
  quantidadeEstoque?: number;
  estoqueMinimo?: number;
  fichasTecnicasIds?: string[];
  fornecedor?: string;
  atualizadoEm: string;
}

export interface InsumoFinanceiro {
  id: string;
  storeId: string;
  quantidadeCompra: number;
  precoCompra: number;
  fatorCorrecao: number;
  custoUnitario: number;
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
  | "rejected"
  | "purchased";

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
  comentarioCompras?: string;
  valorUnitario?: number | null;
  valorTotal?: number | null;
  compradoPor?: string;
  compradoPorEmail?: string;
  compradoEm?: string;
  revisadoPor?: string;
  revisadoPorEmail?: string;
  revisadoEm?: string;
  decisao?: string;
}

export interface VendaSemanalItem {
  produtoId: string;
  produtoNome: string;
  unidadesVendidas: number;
}

export interface VendasSemanais {
  id: string;
  storeId: string;
  semanaInicio: string;
  itens: VendaSemanalItem[];
  importadoPor: string;
  importadoPorEmail: string;
  importadoEm: string;
}

export interface ItemFichaTecnica {
  insumoId: string;
  insumoNome: string;
  quantidade: number;
  unidade: UnidadeMedida;
  custoUnitario?: number;
  custoTotal?: number;
}

export interface FichaTecnica {
  id: string;
  storeId: string;
  produtoId: string;
  nome: string;
  rendimento: number;
  itens: ItemFichaTecnica[];
  custoTotal?: number;
  tipoMeta?: "cmv" | "margem";
  percentualMeta?: number;
  precoVenda?: number;
  custoPorPorcao?: number;
  precoSugerido?: number;
  atualizadoEm: string;
}

export type TipoMetaPrecificacao = "cmv" | "margem";

export interface Produto {
  id: string;
  storeId: string;
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
  storeId: string;
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
  storeId: string;
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
  storeId: string;
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
  storeId: string;
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
  storeId: string;
  fornecedor: string;
  numeroNota: string;
  dataEmissao: string;
  itens: ItemCompra[];
  totalCompra: number;
  nomeArquivo: string;
  criadaEm: string;
  usuarioId: string;
}
