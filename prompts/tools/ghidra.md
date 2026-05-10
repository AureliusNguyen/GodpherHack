## GhidraMCP — Reverse Engineering

Binary analysis tools via the Ghidra reverse engineering framework.

### When to Use
Use GhidraMCP when you need deeper static analysis than `objdump`, `strings`,
or `readelf` can provide — decompilation to C pseudocode, cross-references,
function renaming, etc.

### Setup — Connection Error Recovery
If a GhidraMCP tool returns a connection error (e.g. "Connection closed",
timeout, or connection refused), the user needs to set up Ghidra. **Stop
what you are doing** and give them these exact steps, substituting the real
binary path and filename you discovered from the challenge directory:

1. Open **Ghidra** and create a new project (or open an existing one)
2. Go to **File → Import File** and select: `<full path to the binary>`
3. Accept the default import options and click **OK**
4. Double-click the imported binary to open it in the **CodeBrowser**
5. When prompted to analyze, click **Yes** and then **Analyze** with defaults
6. Wait for analysis to complete (progress bar at bottom-right)
7. Make sure the GhidraMCP bridge server is running:
   ```
   python bridge_mcp_ghidra.py
   ```
8. Tell the user to say **"ready"** when finished

Do NOT silently fall back to objdump/strings when the user explicitly asked
for Ghidra. Guide them through setup first, then retry the Ghidra tools.

### Common Patterns

**Basic recon flow:**
1. `list_functions` → identify interesting function names (main, check_flag, encrypt, etc.)
2. `list_strings` → find embedded strings, flag formats, URLs
3. `list_imports` → see what libraries/syscalls the binary uses
4. `decompile_function` on the key functions → read pseudocode

**Cross-reference analysis:**
1. Find an interesting string or address
2. `get_xrefs_to` → find what code references it
3. `decompile_function` on each caller → trace the logic

**Finding hidden/obfuscated functions:**
1. `search_functions_by_name` with partial names
2. `list_exports` → check exported symbols
3. `get_function_by_address` for addresses found via xrefs or strings
