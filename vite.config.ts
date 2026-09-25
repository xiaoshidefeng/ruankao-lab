import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // 本地 API（Express + MySQL），npm run server 启动
    proxy: { "/api": "http://localhost:8787" },
  },
});
