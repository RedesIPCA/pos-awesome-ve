<script setup lang="ts">
/** Coupon entry, plus any gift coupons already issued to this customer. */
import { onMounted, ref } from "vue";
import { ArrowLeft, Gift, Ticket, X } from "lucide-vue-next";
import { useOffersStore } from "@/stores/offers";
import { useUiStore } from "@/stores/ui";

const offers = useOffersStore();
const ui = useUiStore();
const code = ref("");

onMounted(() => void offers.loadGiftCoupons());

async function apply() {
	const value = code.value.trim();
	if (!value) return;
	await offers.applyCoupon(value);
	code.value = "";
}
</script>

<template>
	<section class="panel flex h-full min-h-0 flex-col overflow-hidden">
		<header class="flex shrink-0 items-center gap-2 border-b border-line p-3">
			<button
				type="button"
				class="grid size-9 place-items-center rounded-card text-muted transition hover:bg-surface-2 hover:text-fg"
				aria-label="Volver a los productos"
				@click="ui.setWorkspace('catalog')"
			>
				<ArrowLeft class="size-4.5" />
			</button>
			<h2 class="text-sm font-semibold">Cupones</h2>
			<span class="ml-auto text-xs text-subtle">{{ offers.coupons.length }} aplicados</span>
		</header>

		<div class="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
			<form class="flex gap-2" @submit.prevent="apply">
				<input
					v-model="code"
					type="text"
					placeholder="Ingresa un código de cupón"
					autocomplete="off"
					class="h-11 min-w-0 flex-1 rounded-card border-line bg-surface font-mono text-sm uppercase shadow-xs focus:border-accent focus:ring-0"
				/>
				<button
					type="submit"
					class="h-11 shrink-0 rounded-card bg-accent px-4 text-sm font-semibold text-accent-fg transition hover:bg-accent-hover disabled:bg-surface-3 disabled:text-subtle"
					:disabled="!code.trim()"
				>
					Aplicar
				</button>
			</form>

			<div v-if="offers.coupons.length">
				<p class="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-subtle">En esta venta</p>
				<ul class="space-y-1.5">
					<li
						v-for="(coupon, i) in offers.coupons"
						:key="coupon.coupon_code"
						class="stagger flex items-center gap-2 rounded-card border border-line bg-surface p-2.5 shadow-xs"
						:style="{ '--i': i }"
					>
						<span class="grid size-8 shrink-0 place-items-center rounded-lg bg-success-soft text-success">
							<Ticket class="size-4" />
						</span>
						<span class="min-w-0 flex-1 truncate font-mono text-sm">{{ coupon.coupon_code }}</span>
						<button
							type="button"
							class="grid size-7 place-items-center rounded-lg text-subtle transition hover:bg-danger-soft hover:text-danger"
							aria-label="Quitar cupón"
							@click="offers.removeCoupon(coupon.coupon_code)"
						>
							<X class="size-3.5" />
						</button>
					</li>
				</ul>
			</div>

			<div v-if="offers.giftCoupons.length">
				<p class="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-subtle">
					Cupones de regalo para este cliente
				</p>
				<ul class="space-y-1.5">
					<li
						v-for="gift in offers.giftCoupons"
						:key="gift"
						class="flex items-center gap-2 rounded-card border border-dashed border-line p-2.5"
					>
						<Gift class="size-4 shrink-0 text-violet" />
						<span class="min-w-0 flex-1 truncate font-mono text-sm">{{ gift }}</span>
						<button
							type="button"
							class="shrink-0 rounded-card bg-accent-soft px-2.5 py-1 text-xs font-semibold text-accent transition hover:opacity-85"
							@click="offers.applyCoupon(gift)"
						>
							Usar
						</button>
					</li>
				</ul>
			</div>

			<p
				v-if="!offers.coupons.length && !offers.giftCoupons.length"
				class="pt-8 text-center text-xs text-muted"
			>
				Aún no hay cupones en esta venta.
			</p>
		</div>
	</section>
</template>
