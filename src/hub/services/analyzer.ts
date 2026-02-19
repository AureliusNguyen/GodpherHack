import { createHash } from "node:crypto";
import type { Provider } from "../../providers/types.js";
import type { ChallengeInput } from "../schemas/challenge.js";
import type { CtfCategory } from "../schemas/common.js";

export const ANALYZER_VERSION = "stub-v1";

export interface AnalysisResult {
  analysisId: string;
  category: CtfCategory;
  categoryConfidence: number;
  keywords: string[];
  suggestedTools: string[];
  analysisNote: string;
}

export class ChallengeAnalyzer {
  constructor(private provider: Provider | null) {}

  async analyze(challenge: ChallengeInput): Promise<AnalysisResult> {
    // Stub: real implementation will use this.provider.chat() for LLM categorization.
    // For now, return heuristic-based results.
    return this.stubAnalysis(challenge);
  }

  async refine(
    challenge: ChallengeInput,
    previousKeywords: string[],
    feedback: string,
  ): Promise<AnalysisResult> {
    // Stub: real implementation will incorporate feedback into the LLM prompt.
    const base = this.stubAnalysis(challenge);
    return {
      ...base,
      keywords: [...new Set([...base.keywords, ...previousKeywords])],
      analysisNote: `Refined after feedback: ${feedback}`,
    };
  }

  private stubAnalysis(challenge: ChallengeInput): AnalysisResult {
    const desc = challenge.description.toLowerCase();
    const { category, confidence } = this.guessCategory(desc);
    const keywords = this.extractKeywords(challenge);
    const tools = this.suggestTools(category);
    const analysisId = createHash("sha256")
      .update(`${ANALYZER_VERSION}|${challenge.name}|${challenge.description}`)
      .digest("hex")
      .slice(0, 12);

    return {
      analysisId,
      category,
      categoryConfidence: confidence,
      keywords,
      suggestedTools: tools,
      analysisNote: "Stub analysis — no LLM provider configured",
    };
  }

  private guessCategory(desc: string): {
    category: CtfCategory;
    confidence: number;
  } {
    const patterns: [CtfCategory, RegExp, number][] = [
      ["pwn", /\b(pwn|buffer|overflow|exploit|rop|shellcode|bof)\b/, 0.7],
      ["rev", /\b(reverse|binary|disassemb|decompil|crackme|deobfuscate|decompile|ghidra|ida|radare2|ltrace)\b/, 0.7],
      ["crypto", /\b(crypt|rsa|aes|cipher|encrypt|decrypt|xor|coppersmith|LLL|BKZ|ZKP|sage)\b/, 0.7],
      ["web", /\b(web|http|sql|xss|cookie|jwt|api|html|curl|XSS|SQL injection|LFI|RFI|RCE|SSRF|XXE|XPATH injection|CSRF|CSP)\b/, 0.7],
      ["forensics", /\b(forensic|pcap|wireshark|memory|disk|image|volatility|binwalk|autopsy|wireshark|stegsolve|zsteg|exiftool|)\b/, 0.7],
      ["osint", /\b(osint|geoloc|social|osint|geolocation|google-dorks)\b/, 0.6],
      ["misc", /\b(misc|trivia|pyjail|sandbox|python|cyberchef)\b/, 0.5],
      ["hardware", /\b(hardware|fpga|fpga-programming|fpga-design|fpga-development|fpga-tools|fpga-board|fpga-board-programming|fpga-board-development|fpga-board-tools)\b/, 0.5],
    ];

    for (const [category, regex, confidence] of patterns) {
      if (regex.test(desc)) return { category, confidence };
    }

    return { category: "misc", confidence: 0.3 };
  }

  private extractKeywords(challenge: ChallengeInput): string[] {
    const text = `${challenge.name} ${challenge.description} ${(challenge.hints ?? []).join(" ")}`;
    const words = text
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 3);
    return [...new Set(words)].slice(0, 15);
  }

  private suggestTools(category: CtfCategory): string[] {
    const toolMap: Record<string, string[]> = {
      pwn: ["gdb", "pwntools", "checksec", "ROPgadget"],
      rev: ["ghidra", "ida", "radare2", "ltrace"],
      crypto: ["sage", "python", "factordb", "RsaCtfTool"],
      web: ["burpsuite", "sqlmap", "dirsearch", "curl"],
      forensics: ["volatility", "binwalk", "autopsy", "wireshark", "stegsolve", "zsteg", "exiftool"],
      osint: ["maltego", "sherlock", "google-dorks"],
      misc: ["python", "cyberchef"],
      mobile: ["jadx", "frida", "apktool"],
      hardware: ["logic-analyzer", "sigrok", "baudrate"],
    };
    return toolMap[category] ?? ["python"];
  }
}
