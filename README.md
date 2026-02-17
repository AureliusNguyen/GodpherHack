# GodpherHack

CLI Agent for CTF solving

## Setup

```bash
npm install
npm run build
```

## Run

```bash
# Run directly
node dist/cli.js

# Or link globally, then use from anywhere
npm link
godpherhack
```

## Commands

```bash
godpherhack          # Launch interactive CLI
godpherhack -V       # Print version
godpherhack --help   # Show help
```

## Scripts

```bash
./build.sh           # Build the project
./run.sh             # Build + launch the CLI
./test.sh            # Run tests
```

## Development

```bash
npm run dev          # Watch mode (rebuild on changes)
npm test             # Run tests
npm run lint         # Type-check
```
