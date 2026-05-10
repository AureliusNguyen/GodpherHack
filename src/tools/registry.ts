import type { ToolAdapter, ToolInfo, ToolResult } from "./types.js";

export class ToolRegistry {
  private adapters = new Map<string, ToolAdapter>();

  register(adapter: ToolAdapter): void {
    if (this.adapters.has(adapter.name)) {
      throw new Error(`Adapter "${adapter.name}" is already registered`);
    }
    this.adapters.set(adapter.name, adapter);
  }

  get(name: string): ToolAdapter | undefined {
    return this.adapters.get(name);
  }

  listAdapters(): string[] {
    return [...this.adapters.keys()];
  }

  async listAllTools(): Promise<Array<{ adapter: string; tool: ToolInfo }>> {
    const results: Array<{ adapter: string; tool: ToolInfo }> = [];
    for (const [name, adapter] of this.adapters) {
      const tools = await adapter.listTools();
      for (const tool of tools) {
        results.push({ adapter: name, tool });
      }
    }
    return results;
  }

  async invoke(qualifiedName: string, args: Record<string, unknown>): Promise<ToolResult> {
    const dotIndex = qualifiedName.indexOf(".");
    if (dotIndex === -1) {
      throw new Error(`Invalid qualified tool name "${qualifiedName}" — expected "AdapterName.toolName"`);
    }

    const adapterName = qualifiedName.slice(0, dotIndex);
    const toolName = qualifiedName.slice(dotIndex + 1);

    const adapter = this.adapters.get(adapterName);
    if (!adapter) {
      throw new Error(`Adapter "${adapterName}" not found`);
    }

    return adapter.invoke(toolName, args);
  }

  async connectAll(): Promise<void> {
    const promises = [...this.adapters.values()].map((a) => a.connect());
    await Promise.all(promises);
  }

  async disconnectAll(): Promise<void> {
    const promises = [...this.adapters.values()].map((a) => a.disconnect());
    await Promise.all(promises);
  }
}
