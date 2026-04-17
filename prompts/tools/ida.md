## IDA Pro MCP — Reverse Engineering

Binary analysis tools via IDA Pro, a professional disassembler and decompiler.

### When to Use
Use IDA Pro MCP when you need professional-grade static analysis — Hex-Rays
decompilation, cross-references, byte pattern search, control flow graphs.
IDA Pro is especially strong for stripped binaries, complex C++ code, and
architectures beyond x86 (ARM, MIPS, etc.).

### Setup — Connection Error Recovery
If an IDA Pro MCP tool returns a connection error (e.g. "Connection closed",
timeout, or connection refused), the user needs to set up IDA Pro. **Stop
what you are doing** and give them these exact steps, substituting the real
binary path and filename you discovered from the challenge directory:

1. Make sure IDA Pro 8.3+ is installed (IDA Free is NOT supported)
2. Install the MCP plugin if not done yet:
   ```
   pip install https://github.com/mrexodia/ida-pro-mcp/archive/refs/heads/main.zip
   ida-pro-mcp --install
   ```
3. Open **IDA Pro** and load the binary: `<full path to the binary>`
4. Wait for auto-analysis to complete (watch the bottom-left status bar)
5. The MCP server starts automatically inside IDA once the plugin is installed
6. Tell the user to say **"ready"** when finished

Do NOT silently fall back to objdump/strings when the user explicitly asked
for IDA. Guide them through setup first, then retry the IDA tools.

### IDA vs Ghidra
If both IDA and Ghidra packs are available, prefer IDA for:
- Stripped/obfuscated binaries (better heuristics)
- Byte pattern matching (`find_bytes` with wildcards)
- Debugging integration (if debugger extension is enabled)

Prefer Ghidra for:
- When the user doesn't have an IDA Pro license
- Java/Dalvik analysis

### Common Patterns

**Basic recon flow:**
1. `list_funcs` → identify interesting function names
2. `imports` → see what libraries/syscalls the binary uses
3. `find` with flag format (e.g. "CTF{", "flag{") → locate flag strings
4. `decompile` on key functions → read pseudocode

**Cross-reference analysis:**
1. Find an interesting string or address
2. `xrefs_to` → find what code references it
3. `decompile` on each caller → trace the logic
4. `callees` → see what a function calls downstream

**Byte pattern search (useful for crypto/encoding):**
1. `find_bytes` with known constants (e.g. AES S-box: `63 7C 77 7B`)
2. `xrefs_to` on the match → find the function using it
3. `decompile` → understand the algorithm

**Control flow analysis:**
1. `basic_blocks` on a function → get the CFG
2. Identify branches and conditions
3. `decompile` for the high-level view
