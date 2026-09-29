# FlyBudget website

The source of [flybudget.org](https://flybudget.org): the homepage, the user guide (`docs/`),
the tour of the app (`tour/`), community pages (`community/`) and the blog (`blog/`). It's built
with [Docusaurus](https://docusaurus.io/).

## Working on it

```bash
npm ci          # once
npm start       # dev server at http://localhost:3000, reloads as you edit
npm run build   # production build in build/; fails on broken links
npm run serve   # serve the production build locally
```

Pages are Markdown (`.mdx`). The sidebars are defined in `sidebars.ts` (guide),
`sidebarsTour.ts` and `sidebarsCommunity.ts`. The app links to guide pages by their file name
(`docsUrl()` in `client/src/utils/project.ts`), so keep those names when reorganizing, or update
the links in the app too.
