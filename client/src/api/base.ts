// The API's address. The desktop app's preload sets __API_BASE__ to its own local server
// (the page may only ever talk to that one); the web app uses /api on its own origin
// (proxied to the server by Vite in development).
export const API_BASE = window.__API_BASE__ ?? '/api';
