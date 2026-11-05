import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Cliente do Oficio. Em `npm run dev` o servidor usa este config em middleware mode;
// `npm run dev:client` sobe só o Vite (com proxy de /api e /ws para o servidor).
// Dev: /avatar-preview serve a página de teste do montador de avatar.
const avatarPreviewRoute = {
  name: 'avatar-preview-route',
  configureServer(server: { middlewares: { use(fn: (req: { url?: string }, res: unknown, next: () => void) => void): void } }) {
    server.middlewares.use((req, _res, next) => {
      if (req.url && /^\/avatar-preview(\?|$)/.test(req.url)) req.url = req.url.replace('/avatar-preview', '/avatar-preview.html');
      next();
    });
  },
};

export default defineConfig({
  plugins: [avatarPreviewRoute],
  root: r('./client'),
  publicDir: r('./client/public'),
  build: {
    outDir: r('./dist/client'),
    emptyOutDir: true,
    // Arquivos gerados com hash vão para /bundle/ (cache immutable no servidor); /assets/ fica só
    // para client/public (nomes fixos, revalidados a cada acesso). Ver server/http/static.ts.
    assetsDir: 'bundle',
    assetsInlineLimit: 0,
    rollupOptions: {
      input: { main: r('./client/index.html'), login: r('./client/login.html'), admin: r('./client/admin.html'), avatarPreview: r('./client/avatar-preview.html') },
    },
  },
  server: {
    port: Number(process.env.VITE_PORT ?? 5173),
    proxy: {
      '/api': { target: `http://127.0.0.1:${process.env.OFFICE_PORT ?? 4747}` },
      '/ws': { target: `http://127.0.0.1:${process.env.OFFICE_PORT ?? 4747}`, ws: true },
    },
  },
});
