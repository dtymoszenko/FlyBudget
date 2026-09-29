// Vite features the demo build uses (it's bundled by the client's Vite config)
declare module '*?url' {
  const url: string;
  export default url;
}

interface ImportMeta {
  glob<T>(
    pattern: string,
    options: { query: string; import: string; eager: true },
  ): Record<string, T>;
}
