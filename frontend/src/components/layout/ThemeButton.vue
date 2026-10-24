<script setup lang="ts">
import { computed } from "vue";
import { Sun, Moon, MonitorSmartphone } from "lucide-vue-next";
import { cycleTheme, themePreference } from "@/lib/theme";

const THEME_LABELS = { light: "Claro", dark: "Oscuro", system: "Sistema" } as const;

const icon = computed(() =>
	themePreference.value === "light" ? Sun : themePreference.value === "dark" ? Moon : MonitorSmartphone,
);
</script>

<template>
	<button
		type="button"
		class="grid size-9 place-items-center rounded-card text-muted transition hover:bg-surface-2 hover:text-fg"
		:title="`Tema: ${THEME_LABELS[themePreference]}`"
		:aria-label="`Tema: ${THEME_LABELS[themePreference]}`"
		@click="cycleTheme()"
	>
		<component :is="icon" class="size-4.5" />
	</button>
</template>
