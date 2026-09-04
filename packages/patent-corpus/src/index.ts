export type { PdfExtractResult } from './adapters/pdf.ts'
export { extractPdfText, splitPdfParagraphs } from './adapters/pdf.ts'
export type { ExtensionSummary, ProbeOptions, ProbeResult } from './adapters/probe.ts'
export { probeMedia } from './adapters/probe.ts'
export type { TsvMapping } from './adapters/tsv.ts'
export { DEFAULT_TSV_MAPPING, normalizeDate, parseTsv } from './adapters/tsv.ts'
export type { ParsedGazette, XmlMapping, XmlParagraph } from './adapters/xml.ts'
export { DEFAULT_XML_MAPPING, decodeEntities, parseGazetteXml } from './adapters/xml.ts'
export type {
  BatchInput,
  BatchRecord,
  Corpus,
  CorpusParagraph,
  CorpusPublication,
  CorpusStats,
  ExtractFailure,
  ExtractFailureInput,
  SearchHit,
  SearchQuery,
  SearchResult,
  Section,
  StoredParagraph,
  StoredPublication,
} from './corpus.ts'
export { buildSnippet, openCorpus } from './corpus.ts'
export type { Embedder, EmbedderOptions, EmbedProvider } from './embed.ts'
export { createEmbedder } from './embed.ts'
export type {
  EmbedCorpusResult,
  EmbedTarget,
  VectorHit,
  VectorSearchQuery,
  VectorSearchResult,
} from './embed-pipeline.ts'
export { embedCorpus, splitParagraph, vectorSearch } from './embed-pipeline.ts'
export { normalizeForQuote } from './normalize.ts'
export type { Sidecar, SidecarOptions } from './server.ts'
export { createSidecar } from './server.ts'
export type { SynthesizedPublication, SynthOptions } from './synth.ts'
export { synthesizePublications } from './synth.ts'
export type { TokenRun, TokenRunKind } from './tokenize.ts'
export { indexTokens, queryExpression, tokenRuns, tokensOfRun } from './tokenize.ts'
export type { Int8Vector } from './vector.ts'
export {
  cosineFloat,
  cosineInt8,
  dequantizeInt8,
  hammingDistance,
  packBinary,
  quantizeInt8,
  topK,
} from './vector.ts'
export type { CheckQuoteInput, QuoteCheck, QuoteCheckResult } from './verify.ts'
export { checkQuote } from './verify.ts'
