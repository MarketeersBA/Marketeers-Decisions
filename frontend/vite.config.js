import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
// Dev server proxies /api to the FastAPI service so the browser sees one origin.
export default defineConfig(function (_a) {
    var mode = _a.mode;
    var env = loadEnv(mode, process.cwd(), "");
    var apiPort = env.VITE_API_PORT || "8000";
    return {
        plugins: [react()],
        server: {
            port: 5173,
            proxy: {
                "/api": {
                    target: "http://localhost:".concat(apiPort),
                    changeOrigin: true,
                },
            },
        },
    };
});
