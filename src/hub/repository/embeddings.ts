/**
 * Embedding provider interface — future swap point for Ollama, LiteLLM, etc.
 *
 * Not used yet: PineconeWriteupRepository uses an integrated index where
 * Pinecone handles embeddings internally. When switching to a standard
 * Pinecone index with custom embeddings, implement this interface and
 * pass it to the repository.
 */
export interface EmbeddingProvider {
  readonly modelName: string;
  readonly dimensions: number;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}
