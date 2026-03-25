import React, { useState, useRef, useEffect } from "react";
import { render, Text, Box, useInput, useApp } from "ink";
import Spinner from "ink-spinner";
import {
  PROVIDER_CHOICES,
  PROVIDERS,
  PROVIDER_MODELS,
  resolveProvider,
  createProvider,
  type Provider,
  type ProviderSlug,
} from "../providers/index.js";
import {
  agentLoop,
  createBuiltinTools,
  buildSystemPrompt,
  McpToolBridge,
  type ProviderMessage,
  type AgentEvent,
} from "../agent/index.js";
import { GHIDRA_TOOL_DEFINITIONS, createGhidraAdapter, IDA_TOOL_DEFINITIONS, createIdaAdapter } from "../tools/index.js";

// --- Display message types (stable IDs for React keys) ---

interface DisplayMessageBase {
  id: string;
  type: string;
}

interface UserMessage extends DisplayMessageBase {
  type: "user";
  text: string;
}

interface AssistantMessage extends DisplayMessageBase {
  type: "assistant";
  text: string;
}

interface ToolCallMessage extends DisplayMessageBase {
  type: "tool_call";
  toolName: string;
  input: Record<string, unknown>;
}

interface ToolResultMessage extends DisplayMessageBase {
  type: "tool_result";
  toolName: string;
  output: string;
  isError: boolean;
  durationMs: number;
}

interface SystemMessage extends DisplayMessageBase {
  type: "system";
  text: string;
}

type DisplayMessage =
  | UserMessage
  | AssistantMessage
  | ToolCallMessage
  | ToolResultMessage
  | SystemMessage;

interface ActiveChoice {
  options: string[];
  onSelect?: (chosen: string) => void;
}

type InputMode = "text" | "choice" | "api-key" | "processing";

// --- Helpers ---

function maskKey(key: string): string {
  if (key.length <= 8) return "*".repeat(key.length);
  return key.slice(0, 4) + "*".repeat(key.length - 8) + key.slice(-4);
}

function truncateText(text: string, maxLines = 15): string {
  const lines = text.split("\n");
  if (lines.length <= maxLines) return text;
  return lines.slice(0, maxLines).join("\n") + `\n[+${lines.length - maxLines} more lines]`;
}

function isTruncatable(msg: DisplayMessage): boolean {
  if (msg.type === "assistant") return msg.text.split("\n").length > 15;
  if (msg.type === "tool_result") return msg.output.split("\n").length > 15;
  return false;
}

function formatToolInput(name: string, input: Record<string, unknown>): string {
  if (name === "bash" && typeof input.command === "string") {
    return `bash(${input.command})`;
  }
  if ((name === "read_file" || name === "write_file") && typeof input.path === "string") {
    return `${name}(${input.path})`;
  }
  if (name === "list_files") {
    return `list_files(${(input.path as string) ?? "."})`;
  }
  const summary = JSON.stringify(input);
  return `${name}(${summary.length > 80 ? summary.slice(0, 77) + "..." : summary})`;
}

// --- Inline markdown renderer ---

interface MdSegment {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
}

/** Parse basic inline markdown: **bold**, *italic*, `code` */
function parseInlineMarkdown(input: string): MdSegment[] {
  const segments: MdSegment[] = [];
  // Match **bold**, *italic*, `code` — in priority order
  const pattern = /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(`(.+?)`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(input)) !== null) {
    // Push plain text before this match
    if (match.index > lastIndex) {
      segments.push({ text: input.slice(lastIndex, match.index) });
    }
    if (match[2] != null) {
      segments.push({ text: match[2], bold: true });
    } else if (match[4] != null) {
      segments.push({ text: match[4], italic: true });
    } else if (match[6] != null) {
      segments.push({ text: match[6], code: true });
    }
    lastIndex = match.index + match[0].length;
  }

  // Remaining plain text
  if (lastIndex < input.length) {
    segments.push({ text: input.slice(lastIndex) });
  }

  return segments.length > 0 ? segments : [{ text: input }];
}

function MarkdownText({ children }: { children: string }) {
  const segments = parseInlineMarkdown(children);
  return (
    <Text wrap="wrap">
      {segments.map((seg, i) => {
        if (seg.code) {
          return <Text key={i} color="yellow">{seg.text}</Text>;
        }
        if (seg.bold) {
          return <Text key={i} bold>{seg.text}</Text>;
        }
        if (seg.italic) {
          return <Text key={i} italic>{seg.text}</Text>;
        }
        return <Text key={i}>{seg.text}</Text>;
      })}
    </Text>
  );
}

// --- Components ---

function Header() {
  return (
    <Box
      borderStyle="round"
      borderColor="cyan"
      paddingX={3}
      justifyContent="center"
    >
      <Text bold color="cyan">
        GodpherHack v0.1.0
      </Text>
    </Box>
  );
}

function MessageView({ msg, expanded }: { msg: DisplayMessage; expanded: boolean }) {
  switch (msg.type) {
    case "user":
      return (
        <Box marginBottom={0}>
          <Text color="green" bold>you</Text>
          <Text color="gray"> &gt; </Text>
          <Text wrap="wrap">{msg.text}</Text>
        </Box>
      );

    case "assistant": {
      const text = expanded ? msg.text : truncateText(msg.text);
      const isTruncated = !expanded && text !== msg.text;
      return (
        <Box flexDirection="column" marginBottom={0}>
          <Box>
            <Text color="cyan" bold>godpherhack</Text>
            <Text color="gray"> &gt; </Text>
            <MarkdownText>{text}</MarkdownText>
          </Box>
          {isTruncated && <Text dimColor>  [ctrl+o to expand]</Text>}
        </Box>
      );
    }

    case "tool_call":
      return (
        <Box marginBottom={0}>
          <Text color="yellow" bold>tool</Text>
          <Text color="gray"> &gt; </Text>
          <Text color="yellow" wrap="wrap">{formatToolInput(msg.toolName, msg.input)}</Text>
        </Box>
      );

    case "tool_result": {
      const output = expanded ? msg.output : truncateText(msg.output);
      const isTruncated = !expanded && output !== msg.output;
      return (
        <Box flexDirection="column" marginBottom={0}>
          <Box>
            <Text color={msg.isError ? "red" : "gray"} bold>result</Text>
            <Text color="gray"> &gt; </Text>
            <Text color={msg.isError ? "red" : undefined} wrap="wrap">
              {output} <Text dimColor>({msg.durationMs}ms)</Text>
            </Text>
          </Box>
          {isTruncated && <Text dimColor>  [ctrl+o to expand]</Text>}
        </Box>
      );
    }

    case "system":
      return (
        <Box marginBottom={0}>
          <Text color="cyan" bold>godpherhack</Text>
          <Text color="gray"> &gt; </Text>
          <MarkdownText>{msg.text}</MarkdownText>
        </Box>
      );
  }
}

function ChoiceSelector({
  options,
  cursor,
}: {
  options: string[];
  cursor: number;
}) {
  const all = [...options, "Other (type your answer)"];
  return (
    <Box flexDirection="column" marginLeft={2} marginTop={1} marginBottom={1}>
      {all.map((opt, i) => {
        const active = i === cursor;
        return (
          <Box key={opt}>
            <Text color={active ? "cyan" : "white"} bold={active}>
              {active ? " > " : "   "}
              {opt}
            </Text>
          </Box>
        );
      })}
      <Box marginTop={1}>
        <Text dimColor>arrow keys to navigate, enter to select</Text>
      </Box>
    </Box>
  );
}

function InputBox({
  value,
  placeholder,
  masked,
}: {
  value: string;
  placeholder?: string;
  masked?: boolean;
}) {
  const display = masked ? "*".repeat(value.length) : value;
  return (
    <Box marginTop={1}>
      <Text color="cyan" bold>
        {">"}{" "}
      </Text>
      {value ? (
        <Text>
          {display}
          <Text color="cyan" bold>
            _
          </Text>
        </Text>
      ) : (
        <Text>
          <Text color="gray">{placeholder || "Type a message..."}</Text>
          <Text color="cyan" bold>
            _
          </Text>
        </Text>
      )}
    </Box>
  );
}

function ProcessingIndicator({ text }: { text: string }) {
  return (
    <Box marginTop={1}>
      <Text color="cyan">
        <Spinner type="dots" />
      </Text>
      <Text> {text}</Text>
    </Box>
  );
}

// --- Main App ---

interface AppProps {
  challengeDir?: string;
}

function App({ challengeDir }: AppProps) {
  const { exit } = useApp();
  const idCounter = useRef(0);
  const nextId = () => String(++idCounter.current);

  const [messages, setMessages] = useState<DisplayMessage[]>([
    {
      id: nextId(),
      type: "system",
      text: "Welcome to GodpherHack! Select a provider to get started.",
    },
  ]);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<InputMode>("choice");
  const [activeChoice, setActiveChoice] = useState<ActiveChoice | null>({
    options: PROVIDER_CHOICES,
    onSelect: handleProviderChoice,
  });
  const [cursor, setCursor] = useState(0);
  const [ctrlCPressed, setCtrlCPressed] = useState(false);
  const [provider, setProvider] = useState<ProviderSlug | null>(null);
  const [pendingProvider, setPendingProvider] = useState<ProviderSlug | null>(null);
  const [processingText, setProcessingText] = useState("");
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [providerInstance, setProviderInstance] = useState<Provider | null>(null);

  // Agent conversation history (replaces llmHistory)
  const agentHistory = useRef<ProviderMessage[]>([]);
  // MCP tool bridge — lazy-connects adapters on first tool invocation
  const mcpBridge = useRef(new McpToolBridge([
    { name: "GhidraMCP", promptKey: "ghidra", tools: GHIDRA_TOOL_DEFINITIONS, createAdapter: createGhidraAdapter },
    { name: "IdaProMCP", promptKey: "ida", tools: IDA_TOOL_DEFINITIONS, createAdapter: createIdaAdapter },
  ]));
  // Disconnect MCP adapters on unmount
  useEffect(() => () => { mcpBridge.current.disconnectAll(); }, []);
  // Expanded message IDs (for ctrl+o toggle)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const pushMessages = (...msgs: DisplayMessage[]) => {
    setMessages((prev) => [...prev, ...msgs]);
  };

  function handleProviderChoice(chosen: string) {
    const slug = resolveProvider(chosen);
    if (slug) {
      setPendingProvider(slug);
      pushMessages({
        id: nextId(),
        type: "system",
        text: `${PROVIDERS[slug].displayName} selected. Enter your API key:`,
      });
      setInput("");
      setMode("api-key");
    }
  }

  const handleModelCommand = () => {
    if (!provider) {
      pushMessages(
        { id: nextId(), type: "user", text: "/model" },
        { id: nextId(), type: "system", text: "No provider selected yet." },
      );
      return;
    }

    const models = PROVIDER_MODELS[provider];
    if (models.length === 0) {
      pushMessages(
        { id: nextId(), type: "user", text: "/model" },
        { id: nextId(), type: "system", text: `No models available for ${PROVIDERS[provider].displayName} yet.` },
      );
      return;
    }

    pushMessages(
      { id: nextId(), type: "user", text: "/model" },
      { id: nextId(), type: "system", text: "Select a model:" },
    );

    setActiveChoice({
      options: models.map((m) => m.label),
      onSelect: (chosen) => {
        const model = models.find((m) => m.label === chosen);
        if (model) {
          setSelectedModel(model.id);
          pushMessages({
            id: nextId(),
            type: "system",
            text: `Model set to ${model.label}.`,
          });
        }
      },
    });
    setCursor(0);
    setMode("choice");
  };

  const runAgentLoop = async (userText: string) => {
    if (!providerInstance) return;

    const cwd = challengeDir ?? process.cwd();
    const tools = [...createBuiltinTools(cwd), ...mcpBridge.current.getTools()];
    const systemPrompt = buildSystemPrompt(cwd, mcpBridge.current.getPromptKeys());

    setProcessingText("Thinking...");
    setMode("processing");

    try {
      const events = agentLoop({
        provider: providerInstance,
        tools,
        systemPrompt,
        history: agentHistory.current,
        userMessage: userText,
        model: selectedModel ?? undefined,
      });

      for await (const event of events) {
        handleAgentEvent(event);
      }
    } catch (err) {
      pushMessages({
        id: nextId(),
        type: "system",
        text: `Error: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setProcessingText("");
      setMode("text");
    }
  };

  const handleAgentEvent = (event: AgentEvent) => {
    switch (event.type) {
      case "text":
        pushMessages({ id: nextId(), type: "assistant", text: event.text });
        break;
      case "tool_call":
        setProcessingText(`Running ${event.name}...`);
        pushMessages({
          id: nextId(),
          type: "tool_call",
          toolName: event.name,
          input: event.input,
        });
        break;
      case "tool_result":
        setProcessingText("Thinking...");
        pushMessages({
          id: nextId(),
          type: "tool_result",
          toolName: event.name,
          output: event.output,
          isError: event.isError,
          durationMs: event.durationMs,
        });
        break;
      case "error":
        pushMessages({ id: nextId(), type: "system", text: `Error: ${event.message}` });
        break;
      case "turn_complete":
        break;
    }
  };

  const processUserInput = (text: string) => {
    // Handle /model command
    if (text.trim().toLowerCase() === "/model") {
      handleModelCommand();
      return;
    }

    // If no provider yet, prompt to pick one
    if (!providerInstance) {
      pushMessages(
        { id: nextId(), type: "user", text },
        { id: nextId(), type: "system", text: "No provider configured. Pick one first:" },
      );
      setActiveChoice({
        options: PROVIDER_CHOICES,
        onSelect: handleProviderChoice,
      });
      setCursor(0);
      setMode("choice");
      return;
    }

    // Run agent loop
    pushMessages({ id: nextId(), type: "user", text });
    runAgentLoop(text);
  };

  const submitApiKey = (key: string) => {
    if (!pendingProvider) return;

    const info = PROVIDERS[pendingProvider];
    pushMessages({ id: nextId(), type: "user", text: maskKey(key) });

    setInput("");
    setProcessingText(`Initializing ${info.name}...`);
    setMode("processing");

    createProvider(pendingProvider, key)
      .then((instance) => {
        setProvider(pendingProvider);
        setProviderInstance(instance);
        const models = PROVIDER_MODELS[pendingProvider];
        if (models.length > 0) setSelectedModel(models[0].id);
        pushMessages({
          id: nextId(),
          type: "system",
          text: `${info.displayName} is ready. Start chatting!`,
        });
      })
      .catch((err) => {
        pushMessages({
          id: nextId(),
          type: "system",
          text: `Failed to initialize ${info.name}: ${err instanceof Error ? err.message : String(err)}`,
        });
      })
      .finally(() => {
        setPendingProvider(null);
        setProcessingText("");
        setMode("text");
      });
  };

  useInput((ch, key) => {
    // Double Ctrl+C to exit
    if (key.ctrl && ch === "c") {
      if (ctrlCPressed) {
        exit();
      } else {
        setCtrlCPressed(true);
        setTimeout(() => setCtrlCPressed(false), 2000);
      }
      return;
    }

    // Any other key resets the Ctrl+C state
    if (ctrlCPressed) setCtrlCPressed(false);

    // Ctrl+O — toggle expand on last truncated message
    if (key.ctrl && ch === "o") {
      const truncatable = messages.filter(
        (m) => (m.type === "assistant" || m.type === "tool_result") && isTruncatable(m),
      );
      if (truncatable.length > 0) {
        const last = truncatable[truncatable.length - 1];
        setExpandedIds((prev) => {
          const next = new Set(prev);
          if (next.has(last.id)) next.delete(last.id);
          else next.add(last.id);
          return next;
        });
      }
      return;
    }

    // Processing mode — ignore all input
    if (mode === "processing") return;

    // Choice mode
    if (mode === "choice" && activeChoice) {
      const total = activeChoice.options.length + 1; // +1 for "Other"

      if (key.upArrow) {
        setCursor((c) => (c > 0 ? c - 1 : total - 1));
      } else if (key.downArrow) {
        setCursor((c) => (c < total - 1 ? c + 1 : 0));
      } else if (key.return) {
        if (cursor === activeChoice.options.length) {
          // "Other" - switch to text input
          setActiveChoice(null);
          setMode("text");
        } else {
          const chosen = activeChoice.options[cursor];
          const onSelect = activeChoice.onSelect;
          setActiveChoice(null);
          setMode("text");
          if (onSelect) {
            onSelect(chosen);
          } else {
            processUserInput(chosen);
          }
        }
      }
      return;
    }

    // API key mode
    if (mode === "api-key") {
      if (key.return) {
        if (input.trim()) {
          submitApiKey(input.trim());
        }
      } else if (key.backspace || key.delete) {
        setInput((v) => v.slice(0, -1));
      } else if (ch && !key.ctrl && !key.meta && !key.escape) {
        setInput((v) => v + ch);
      }
      return;
    }

    // Text mode
    if (key.return) {
      if (input.trim()) {
        const text = input.trim();
        setInput("");
        processUserInput(text);
      }
    } else if (key.backspace || key.delete) {
      setInput((v) => v.slice(0, -1));
    } else if (ch && !key.ctrl && !key.meta && !key.escape) {
      setInput((v) => v + ch);
    }
  });

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Header />

      <Box flexDirection="column" marginTop={1}>
        {messages.map((msg) => (
          <MessageView key={msg.id} msg={msg} expanded={expandedIds.has(msg.id)} />
        ))}
      </Box>

      {mode === "choice" && activeChoice ? (
        <ChoiceSelector options={activeChoice.options} cursor={cursor} />
      ) : mode === "api-key" ? (
        <InputBox value={input} placeholder="Paste your API key..." masked />
      ) : mode === "processing" ? (
        <ProcessingIndicator text={processingText} />
      ) : (
        <InputBox value={input} />
      )}

      <Box marginTop={1} justifyContent="space-between">
        <Box>
          {ctrlCPressed ? (
            <Text color="yellow">Press Ctrl+C again to exit</Text>
          ) : (
            <Text dimColor>ctrl+c to exit · /model to switch · ctrl+o to expand</Text>
          )}
        </Box>
        {selectedModel && (
          <Box>
            <Text dimColor>
              {PROVIDER_MODELS[provider!]?.find((m) => m.id === selectedModel)?.label ?? selectedModel}
            </Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}

export async function startApp(opts?: { challengeDir?: string }) {
  const instance = render(<App challengeDir={opts?.challengeDir} />, { exitOnCtrlC: false });
  await instance.waitUntilExit();
}
