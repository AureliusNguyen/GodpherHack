<tool name="qemu_run">

## When to use

Use `qemu_run` when a CTF binary is built for an architecture other than
the host (almost always non-x86_64). Run `file <binary>` first; if the
output is anything like `ELF 32-bit ARM`, `ELF 32-bit MIPS`, `ELF 64-bit
RISC-V`, `aarch64`, etc., the bash tool cannot run it directly -- use
`qemu_run` with the matching `arch`.

For x86_64 Linux ELFs, use the bash tool. qemu just adds overhead.

## Input

- `binaryPath` (required): path to the ELF, relative to the challenge dir
- `arch`: one of `x86_64`, `i386`, `arm`, `aarch64`, `mips`, `mipsel`,
  `riscv64`. Defaults to `x86_64`.
- `stdin`: optional input piped to the binary.
- `timeoutSec`: kill after N seconds (default 10).

## Output

stdout, then `[stderr]` block if any, then a tail line indicating exit
code, signal, or timeout.

## Limitations

- User-mode emulation only. No networking, no kernel exploitation, no
  privileged ops. For those you need a full system VM (not in scope).
- Requires `qemu-user` (or `qemu-user-static`) installed on the host.
  ENOENT errors mean the package is missing -- tell the user to install
  `qemu-user-static`.
- Output is capped at 256 KB per stream.

## Common patterns

```
qemu_run({ binaryPath: "challenge", arch: "arm" })
qemu_run({ binaryPath: "vuln", arch: "mips", stdin: "AAAA\\n" })
qemu_run({ binaryPath: "slow_check", timeoutSec: 60 })
```

## Failure recovery

- "is not installed": stop, surface this to the user. Do not retry.
- Wrong arch (`Invalid ELF image` from qemu): re-run `file` to determine
  the real architecture.
- Timeout: if the binary expects more input than was provided, supply it
  via `stdin`. If it's genuinely slow, raise `timeoutSec`.

</tool>