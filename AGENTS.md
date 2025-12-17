# AGENTS.md - Coding Guidelines for cast-magnet-link-worker

## Build/Lint/Test Commands
- **Dev server (Node.js)**: `npm run node:dev`
- **Dev server (Worker)**: `npm run worker:dev`
- **Build assets**: `npm run build:assets`
- **Deploy worker**: `npm run worker:deploy`
- **No linting configured** - run `npm install --save-dev eslint` to add
- **No tests configured** - run `npm install --save-dev jest` to add
- **Single test**: Not available (no test framework setup)

## Code Style Guidelines

### Imports & Naming
- ES6 imports with relative paths, include `.js` extension: `import { foo } from './foo.js'`
- Functions/variables: camelCase (`getEnv`, `addTorrent`)
- Constants: UPPER_SNAKE_CASE (`RD_API_BASE`)
- Files: camelCase with `.js` extension

### Formatting & Structure
- 4-space indentation, single quotes, async/await preferred
- JSDoc comments for exported functions
- `const` for immutable values, `let` for mutable
- Arrow functions for callbacks, early returns

### Error Handling & Security
- Throw descriptive `Error` objects with console logging
- Never log sensitive data (tokens, passwords)
- Validate environment variables before use
- Use Proxy pattern for universal environment access (see `src/env.js`)</content>
<parameter name="filePath">AGENTS.md