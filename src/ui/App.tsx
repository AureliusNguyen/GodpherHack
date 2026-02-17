import React, { useState } from "react";
import { render, Text, Box, useInput, useApp } from "ink";


interface ChatMessage {
  role: "user" | "system";
  text: string;
}

interface ActiveChoice {
  options: string[];
}

type InputMode = "text" | "choice";

// Demo response engine (will be replaced by LLM in future)

function getDemoResponse(
  text: string,
  turn: number,
): { text: string; choices?: string[] } {
  const lower = text.toLowerCase();

  if (turn === 0) {
    return {
      text: "Nice to meet you! What would you like to do?",
      choices: [
        "Solve a challenge",
        "Configure API keys",
        "View past runs",
        "Run diagnostics",
      ],
    };
  }

  if (lower.includes("solve") || lower.includes("challenge")) {
    return {
      text: "Which model would you like to use for solving?",
      choices: ["Claude (Anthropic)", "GPT-4 (OpenAI)", "Gemini (Google)"],
    };
  }

  if (
    lower.includes("api") ||
    lower.includes("key") ||
    lower.includes("config")
  ) {
    return {
      text: "API key configuration coming next sprint. Which provider are you setting up?",
      choices: ["Anthropic", "OpenAI", "Google", "Custom endpoint"],
    };
  }

  if (lower.includes("claude") || lower.includes("anthropic")) {
    return {
      text: "Claude selected! You'll need an Anthropic API key. This will be configurable soon.",
    };
  }

  if (lower.includes("gpt") || lower.includes("openai")) {
    return {
      text: "GPT-4 selected! You'll need an OpenAI API key. This will be configurable soon.",
    };
  }

  if (lower.includes("runs") || lower.includes("history")) {
    return { text: "No runs found yet. Start by solving a challenge!" };
  }

  if (lower.includes("diagnostic")) {
    return { text: "All systems operational. Node " + process.version + "." };
  }

  return {
    text: `Roger that. This is demo mode — your chosen LLM will power responses soon.`,
  };
}

// Components 

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

function Message({ msg }: { msg: ChatMessage }) {
  const label = msg.role === "system" ? "godpherhack" : "you";
  const color = msg.role === "system" ? "cyan" : "green";

  return (
    <Box marginBottom={0}>
      <Text color={color} bold>
        {label}
      </Text>
      <Text color="gray"> &gt; </Text>
      <Text wrap="wrap">{msg.text}</Text>
    </Box>
  );
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
          <Box key={i}>
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

function InputBox({ value }: { value: string }) {
  return (
    <Box marginTop={1}>
      <Text color="cyan" bold>
        {">"}{" "}
      </Text>
      {value ? (
        <Text>
          {value}
          <Text color="cyan" bold>
            _
          </Text>
        </Text>
      ) : (
        <Text>
          <Text color="gray">Type a message...</Text>
          <Text color="cyan" bold>
            _
          </Text>
        </Text>
      )}
    </Box>
  );
}

// Main App

function App() {
  const { exit } = useApp();
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "system",
      text: "Welcome to GodpherHack! Type anything to get started.",
    },
  ]);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<InputMode>("text");
  const [activeChoice, setActiveChoice] = useState<ActiveChoice | null>(null);
  const [cursor, setCursor] = useState(0);
  const [turn, setTurn] = useState(0);
  const [ctrlCPressed, setCtrlCPressed] = useState(false);

  const pushMessages = (...msgs: ChatMessage[]) => {
    setMessages((prev) => [...prev, ...msgs]);
  };

  const processUserInput = (text: string) => {
    const response = getDemoResponse(text, turn);
    setTurn((t) => t + 1);

    pushMessages({ role: "user", text }, { role: "system", text: response.text });

    if (response.choices) {
      setActiveChoice({ options: response.choices });
      setCursor(0);
      setMode("choice");
    }
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
          setActiveChoice(null);
          setMode("text");
          processUserInput(chosen);
        }
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
        {messages.map((msg, i) => (
          <Message key={i} msg={msg} />
        ))}
      </Box>

      {mode === "choice" && activeChoice ? (
        <ChoiceSelector options={activeChoice.options} cursor={cursor} />
      ) : (
        <InputBox value={input} />
      )}

      <Box marginTop={1}>
        {ctrlCPressed ? (
          <Text color="yellow">Press Ctrl+C again to exit</Text>
        ) : (
          <Text dimColor>ctrl+c to exit</Text>
        )}
      </Box>
    </Box>
  );
}

export async function startApp() {
  const instance = render(<App />, { exitOnCtrlC: false });
  await instance.waitUntilExit();
}
