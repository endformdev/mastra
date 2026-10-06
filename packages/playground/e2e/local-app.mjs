import { pathToFileURL } from 'node:url';

// The existing MCP journey enters localhost:4111 in Studio. Server-side calls
// to that origin belong to this isolated application, not the pool controller.
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname === 'localhost' && url.port === process.env.E2E_CONTROL_PORT) {
    url.port = process.env.PORT;
    return originalFetch(input instanceof Request ? new Request(url, input) : url, init);
  }
  return originalFetch(input, init);
};

await import(pathToFileURL(process.argv[2]).href);
