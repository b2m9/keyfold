import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    dts: true,
    exports: true,
    format: ["esm"],
    sourcemap: true,
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
  fmt: {},
});
