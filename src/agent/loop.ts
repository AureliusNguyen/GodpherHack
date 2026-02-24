import type {
  AgentEvent,
  ChatResponse,
  ContentBlock,
  ProviderMessage,
  RegisteredTool,
  ToolResultContent,
} from "./types.js";
import type { Provider } from "../providers/types.js";

const MAX_ITERATIONS = 20;
const MAX_TOOL_OUTPUT_LINES = 200;

export interface AgentLoopParams {
  provider: Provider;
  tools: RegisteredTool[];
  systemPrompt: string;
  history: ProviderMessage[];
  userMessage: string;
  model?: string;
}

function truncateToolOutput(output: string): string {
  const lines = output.split("\n");
  if (lines.length <= MAX_TOOL_OUTPUT_LINES) return output;
  return lines.slice(0, MAX_TOOL_OUTPUT_LINES).join("\n") + `\n[truncated — ${lines.length - MAX_TOOL_OUTPUT_LINES} more lines]`;
}

/**
 * Agentic loop — async generator that yields AgentEvents.
 * Mutates the provided history array in place (caller keeps a reference).
 */
export async function* agentLoop(params: AgentLoopParams): AsyncGenerator<AgentEvent> {
  const { provider, tools, systemPrompt, history, userMessage, model } = params;

  if (!provider.chatWithTools) {
    yield { type: "error", message: "Provider does not support chatWithTools (agentic tool use)" };
    return;
  }

  const toolMap = new Map<string, RegisteredTool>();
  for (const tool of tools) {
    toolMap.set(tool.definition.name, tool);
  }

  // Append user message to history
  history.push({ role: "user", content: userMessage });

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    let response: ChatResponse;
    try {
      response = await provider.chatWithTools(history, {
        model,
        system: systemPrompt,
        tools: tools.map((t) => t.definition),
      });
    } catch (err) {
      yield { type: "error", message: err instanceof Error ? err.message : String(err) };
      return;
    }

    // Yield text blocks
    for (const block of response.content) {
      if (block.type === "text" && block.text.trim()) {
        yield { type: "text", text: block.text };
      }
    }

    // If no tool use, we're done
    if (response.stopReason !== "tool_use") {
      // Append assistant message to history
      history.push({ role: "assistant", content: response.content });
      yield { type: "turn_complete" };
      return;
    }

    // Collect tool_use blocks
    const toolUseBlocks = response.content.filter(
      (b): b is ContentBlock & { type: "tool_use" } => b.type === "tool_use",
    );

    if (toolUseBlocks.length === 0) {
      // stop_reason was tool_use but no tool_use blocks — shouldn't happen
      history.push({ role: "assistant", content: response.content });
      yield { type: "turn_complete" };
      return;
    }

    // Append assistant message (with tool_use blocks) to history
    history.push({ role: "assistant", content: response.content });

    // Execute each tool and collect results
    const toolResults: ToolResultContent[] = [];

    for (const block of toolUseBlocks) {
      yield { type: "tool_call", id: block.id, name: block.name, input: block.input };

      const tool = toolMap.get(block.name);
      const start = Date.now();

      if (!tool) {
        const output = `Error: unknown tool "${block.name}"`;
        toolResults.push({ type: "tool_result", toolUseId: block.id, content: output, isError: true });
        yield { type: "tool_result", id: block.id, name: block.name, output, isError: true, durationMs: Date.now() - start };
        continue;
      }

      try {
        const rawOutput = await tool.execute(block.input);
        const output = truncateToolOutput(rawOutput);
        const isError = output.startsWith("Error:");
        toolResults.push({ type: "tool_result", toolUseId: block.id, content: output, isError });
        yield { type: "tool_result", id: block.id, name: block.name, output, isError, durationMs: Date.now() - start };
      } catch (err) {
        const output = `Error: ${err instanceof Error ? err.message : String(err)}`;
        toolResults.push({ type: "tool_result", toolUseId: block.id, content: output, isError: true });
        yield { type: "tool_result", id: block.id, name: block.name, output, isError: true, durationMs: Date.now() - start };
      }
    }

    // Append tool results as a user message
    history.push({ role: "user", content: toolResults });
  }

  // Exceeded max iterations
  yield { type: "error", message: `Agent reached maximum iterations (${MAX_ITERATIONS})` };
}
