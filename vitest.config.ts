import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['server/**/*.test.ts', 'shared/**/*.test.ts', 'client/src/**/*.test.ts'],
    environment: 'node',
    // Os testes existentes comparam textos em pt-BR; o idioma padrão do app é en.
    setupFiles: ['./test/setup.ts'],
    // Os testes de arte (pixel art procedural) são pesados e estouravam 5 s com os workers em paralelo.
    testTimeout: 20_000,
  },
});
