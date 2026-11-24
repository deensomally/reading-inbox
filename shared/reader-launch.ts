// Older production workers hand this navigation to the network. Serve the
// launch document from the reader's origin, outside the feed API proxy.
export const readerLaunchPath = "/api/open.html";
export const feedProxyPath = "^/api(?:/|$)(?!open\\.html(?:[?#]|$))";
