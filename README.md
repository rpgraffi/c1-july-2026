# c1-july-2026

3D intro experience for tacto ("The Perfect Buy") — logo satellite over Earth, built with React Three Fiber.

**Live:** https://c1-july-2026.vercel.app

## Stack

- [TanStack Start](https://tanstack.com/start) (React 19, file-based routing, SSR)
- [React Three Fiber](https://r3f.docs.pmnd.rs/) + drei + three.js for the 3D scene
- Tailwind CSS 4, Radix UI, framer-motion
- Vite 8 + Nitro (server build), scaffolded via [Lovable](https://lovable.dev)

## Development

```bash
npm install
npm run dev
```

## Deployment (Vercel)

Hosted on Vercel as project `c1-july-2026`. Nitro auto-targets Vercel via the
`NITRO_PRESET` env var, producing a Build Output API bundle in `.vercel/output`.

To deploy:

```bash
NITRO_PRESET=vercel npm run build
vercel deploy --prebuilt          # preview
vercel deploy --prebuilt --prod   # production
```

Requires the [Vercel CLI](https://vercel.com/docs/cli) and a linked project
(`vercel link`).

> [!NOTE]
> **Pushing to `main` does NOT deploy.** There is no Git integration — the
> Vercel account has no GitHub login connection, so deploys are manual via the
> commands above. To enable push-to-deploy: add GitHub as a login connection in
> the Vercel account settings, then run `vercel git connect`.

Note: a fully static export (TanStack Start SPA mode + Nitro `static` preset)
currently fails with Nitro v3 beta, so the app deploys as SSR on Vercel
serverless instead.
