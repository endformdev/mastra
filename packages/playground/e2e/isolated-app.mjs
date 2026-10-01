import { pathToFileURL } from 'node:url';

// Tests can configure MCP clients with the public gateway URL. Calls originating
// inside an isolated application must return to that same application, not rely
// on a browser lease header that the MCP SDK does not know about.
const gatewayPort = process.env.E2E_GATEWAY_PORT;
const port = process.env.PORT;
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if ((url.hostname === 'localhost' || url.hostname === '127.0.0.1') && url.port === gatewayPort) {
    url.port = port;
    const redirected = input instanceof Request ? new Request(url, input) : url;
    return originalFetch(redirected, init);
  }
  return originalFetch(input, init);
};

await import(pathToFileURL(process.argv[2]).href);
