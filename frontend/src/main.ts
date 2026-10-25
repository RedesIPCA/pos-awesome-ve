import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { router } from "./router";
import { initTheme } from "@/lib/theme";
import { initHotkeys } from "@/lib/hotkeys";
import "@/styles/main.css";

const app = createApp(App);
app.use(createPinia());
app.use(router);

initTheme();
initHotkeys();

app.mount("#app");

// Service worker: guarda la pantalla y los archivos del POS para abrir sin internet. Lo sirve el
// servidor en /posawesome-sw.js (ver posawesome/renderers.py). Solo en produccion.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
	window.addEventListener("load", () => {
		navigator.serviceWorker.register("/posawesome-sw.js", { scope: "/posawesome" }).catch(() => {
			/* sin service worker el POS sigue funcionando, solo no abre sin internet */
		});
	});
}
