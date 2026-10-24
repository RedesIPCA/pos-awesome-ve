<script setup lang="ts">
/** The invoice: who it is for, what is on it, and what it comes to. */
import { computed, ref } from "vue";
import {
	ClipboardList,
	CreditCard,
	FileClock,
	Gift,
	Loader2,
	Pause,
	Percent,
	Settings2,
	ShoppingCart,
	Ticket,
	Trash2,
	Undo2,
	UserPen,
	UserPlus,
	X,
} from "lucide-vue-next";
import { useCartStore } from "@/stores/cart";
import { useUiStore } from "@/stores/ui";
import { useOffersStore } from "@/stores/offers";
import { usePaymentsStore } from "@/stores/payments";
import { useSessionStore } from "@/stores/session";
import CustomerPicker from "@/components/customer/CustomerPicker.vue";
import CartLine from "./CartLine.vue";
import CartTotals from "./CartTotals.vue";

const emit = defineEmits<{ pay: [] }>();

const cart = useCartStore();
const ui = useUiStore();
const offers = useOffersStore();
const payments = usePaymentsStore();
const session = useSessionStore();

const holding = ref(false);
const canPay = computed(() => !cart.isEmpty && !!cart.customer);

function abandonReturn() {
	const against = cart.returnAgainst;
	cart.cancelReturn();
	payments.reset();
	offers.reset();
	ui.notify({
		title: "Devolución cancelada",
		detail: against ? `No se reembolsó nada contra ${against}.` : undefined,
		tone: "info",
	});
}

async function hold() {
	if (cart.isEmpty || !cart.customer) {
		ui.warn(cart.isEmpty ? "El carrito está vacío" : "Selecciona un cliente primero");
		return;
	}
	holding.value = true;
	try {
		const doc = await cart.saveDraft();
		if (doc) {
			ui.success("Factura puesta en espera", doc.name as string);
			cart.reset();
		}
	} catch (error) {
		// Holding parks a *draft* on the server, which needs a name only the server can
		// issue — so unlike completing a sale it cannot be queued. Say that plainly
		// instead of surfacing a bare "Offline".
		if (!session.serverReachable) {
			ui.warn(
				"No se puede poner en espera sin conexión",
				"Poner en espera requiere el servidor. Completa la venta: se guardará en esta terminal y se enviará cuando vuelva la conexión.",
			);
			return;
		}
		ui.fail("No se pudo poner la factura en espera", error instanceof Error ? error.message : String(error));
	} finally {
		holding.value = false;
	}
}
</script>

<template>
	<section class="panel flex h-full min-h-0 flex-col overflow-hidden">
		<header class="shrink-0 space-y-2.5 p-3">
			<div class="flex items-center gap-2">
				<div class="min-w-0 flex-1"><CustomerPicker /></div>
				<button
					type="button"
					class="grid size-11 shrink-0 place-items-center rounded-card border border-line bg-surface text-muted shadow-xs transition hover:border-accent hover:text-accent"
					title="Nuevo cliente"
					aria-label="Nuevo cliente"
					@click="ui.openModal('customer')"
				>
					<UserPlus class="size-4" />
				</button>
				<button
					v-if="cart.customer"
					type="button"
					class="grid size-11 shrink-0 place-items-center rounded-card border border-line bg-surface text-muted shadow-xs transition hover:border-accent hover:text-accent"
					title="Editar cliente"
					aria-label="Editar cliente"
					@click="ui.openModal('customer', { customerId: cart.customer })"
				>
					<UserPen class="size-4" />
				</button>
			</div>

			<!-- Invoice actions -->
			<div class="flex items-center gap-1 overflow-x-auto pb-0.5">
				<!-- A return in progress is a mode, so it needs a visible way out. Nothing
				     has been submitted yet, so abandoning it just clears the cart. -->
				<button
					v-if="cart.isReturn"
					type="button"
					class="inline-flex shrink-0 items-center gap-1.5 rounded-card bg-danger-soft px-2.5 py-1.5 text-xs font-semibold text-danger transition hover:opacity-85"
					@click="abandonReturn"
				>
					<X class="size-3.5" /> Cancelar devolución
				</button>
				<button
					type="button"
					class="inline-flex shrink-0 items-center gap-1.5 rounded-card px-2.5 py-1.5 text-xs font-medium text-muted transition hover:bg-surface-2 hover:text-fg"
					@click="ui.openModal('drafts')"
				>
					<FileClock class="size-3.5" /> En espera <kbd class="font-mono text-[10px] text-subtle">F3</kbd>
				</button>
				<button
					v-if="session.profile?.posa_allow_return"
					type="button"
					class="inline-flex shrink-0 items-center gap-1.5 rounded-card px-2.5 py-1.5 text-xs font-medium text-muted transition hover:bg-surface-2 hover:text-fg"
					@click="ui.openModal('returns')"
				>
					<Undo2 class="size-3.5" /> Devolución
				</button>
				<button
					v-if="session.profile?.posa_allow_sales_order || session.profile?.custom_allow_select_sales_order"
					type="button"
					class="inline-flex shrink-0 items-center gap-1.5 rounded-card px-2.5 py-1.5 text-xs font-medium text-muted transition hover:bg-surface-2 hover:text-fg"
					@click="ui.openModal('orders')"
				>
					<ClipboardList class="size-3.5" /> Pedidos
				</button>
				<button
					type="button"
					class="inline-flex shrink-0 items-center gap-1.5 rounded-card px-2.5 py-1.5 text-xs font-medium text-muted transition hover:bg-surface-2 hover:text-fg"
					@click="ui.setWorkspace('coupons')"
				>
					<Ticket class="size-3.5" /> Cupones
				</button>
				<button
					type="button"
					class="inline-flex shrink-0 items-center gap-1.5 rounded-card px-2.5 py-1.5 text-xs font-medium text-muted transition hover:bg-surface-2 hover:text-fg"
					@click="ui.openModal('invoiceDetails')"
				>
					<Settings2 class="size-3.5" /> Detalles
				</button>
			</div>

			<div class="flex items-center justify-between gap-2 text-xs">
				<span class="font-medium text-muted">
					{{ cart.itemCount }} {{ cart.itemCount === 1 ? "línea" : "líneas" }}
					<span v-if="cart.dirty && cart.invoiceName" class="text-warning"> · sin guardar</span>
				</span>
				<div class="flex items-center gap-1">
					<button
						v-if="offers.pendingCount"
						type="button"
						class="inline-flex animate-pulse-ring items-center gap-1 rounded-full bg-violet-soft px-2 py-1 text-[11px] font-semibold text-violet transition hover:opacity-85"
						@click="ui.setWorkspace('offers')"
					>
						<Percent class="size-3" />
						{{ offers.pendingCount }} {{ offers.pendingCount === 1 ? "oferta" : "ofertas" }}
					</button>
					<span
						v-else-if="offers.appliedCount"
						class="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-1 text-[11px] font-semibold text-success"
					>
						<Gift class="size-3" /> {{ offers.appliedCount }} aplicadas
					</span>
					<button
						v-if="!cart.isEmpty"
						type="button"
						class="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium text-subtle transition hover:bg-danger-soft hover:text-danger"
						@click="cart.reset()"
					>
						<Trash2 class="size-3" /> Vaciar
					</button>
				</div>
			</div>
		</header>

		<!-- Lines -->
		<!-- overflow-x must be stated: with only overflow-y set, CSS promotes the
		     visible axis to auto, and any transform that leaves the box gets a
		     horizontal scrollbar. -->
		<div class="min-h-0 flex-1 overflow-y-auto overflow-x-hidden border-t border-line">
			<div
				v-if="cart.isEmpty"
				class="flex h-full flex-col items-center justify-center gap-2 p-8 text-center"
			>
				<ShoppingCart class="size-10 text-subtle" />
				<p class="text-sm font-medium">El carrito está vacío</p>
				<p class="max-w-[18rem] text-xs text-muted">
					Escanea un código de barras o elige un producto para iniciar la venta.
				</p>
			</div>

		<TransitionGroup
			v-else
			tag="div"
			class="relative divide-y divide-line"
			enter-active-class="transition duration-[280ms] ease-[cubic-bezier(0.34,1.56,0.64,1)]"
			enter-from-class="-translate-y-3 scale-[0.985] opacity-0"
			leave-active-class="absolute inset-x-0 transition duration-[180ms] ease-out pointer-events-none"
			leave-to-class="scale-[0.97] opacity-0"
			move-class="transition duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
		>
			<CartLine v-for="line in cart.items" :key="line.posa_row_id" :line="line" />
		</TransitionGroup>
		</div>

		<CartTotals v-if="!cart.isEmpty" />

		<footer class="flex shrink-0 gap-2 p-3 pt-0">
			<button
				type="button"
				class="flex h-13 w-13 shrink-0 items-center justify-center rounded-card border border-line bg-surface text-muted shadow-xs transition hover:border-warning hover:text-warning disabled:opacity-40"
				:title="cart.isReturn ? 'Una devolución no se puede poner en espera' : 'Poner esta factura en espera'"
				:aria-label="cart.isReturn ? 'Una devolución no se puede poner en espera' : 'Poner esta factura en espera'"
				:disabled="!canPay || holding || cart.isReturn"
				@click="hold"
			>
				<Loader2 v-if="holding" class="size-5 animate-spin" />
				<Pause v-else class="size-5" />
			</button>
			<button
				type="button"
				class="flex h-13 min-w-0 flex-1 items-center justify-center gap-2 rounded-card text-base font-semibold shadow-glow transition active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-subtle disabled:shadow-none"
				:class="
					cart.isReturn
						? 'bg-danger text-white hover:opacity-90'
						: 'bg-accent text-accent-fg hover:bg-accent-hover'
				"
				:disabled="!canPay"
				@click="emit('pay')"
			>
				<Undo2 v-if="cart.isReturn" class="size-5" />
				<CreditCard v-else class="size-5" />
				{{ cart.isReturn ? "Reembolsar" : "Cobrar" }}
				<kbd class="ml-1 rounded bg-black/15 px-1.5 py-0.5 font-mono text-[11px]">F8</kbd>
			</button>
		</footer>
	</section>
</template>
