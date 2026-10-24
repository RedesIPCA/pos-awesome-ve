<script setup lang="ts">
/** Tender screen. Big targets, tabular numbers, and one obvious primary action. */
import { computed, onMounted, watch } from "vue";
import {
	ArrowLeft,
	Banknote,
	Check,
	CheckCircle2,
	CloudOff,
	Coins,
	Loader2,
	Printer,
	Plus,
	Smartphone,
	WalletCards,
} from "lucide-vue-next";
import { formatCurrency, formatFloat, toNumber } from "@/lib/format";
import { usePaymentsStore } from "@/stores/payments";
import { useCartStore } from "@/stores/cart";
import { useUiStore } from "@/stores/ui";
import { useOffersStore } from "@/stores/offers";
import { useSessionStore } from "@/stores/session";

const payments = usePaymentsStore();
const cart = useCartStore();
const ui = useUiStore();
const offers = useOffersStore();
const session = useSessionStore();

/** Round-number shortcuts a cashier actually reaches for. */
const QUICK = [5, 10, 20, 50, 100, 200, 500];

/** Display-only names for the credit kinds; the raw value is what the logic uses. */
const CREDIT_TYPE_LABELS: Record<string, string> = { Invoice: "Nota de crédito", Advance: "Anticipo" };

const done = computed(() => !!payments.lastInvoice);
/** A sale parked on the terminal: real to the customer, not yet on the server. */
const queued = computed(() => !!payments.lastInvoice?.__queued);
const isReturn = computed(() => cart.isReturn);

onMounted(() => void payments.loadRates());

const fx = (n: number) => n.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const SYMBOL: Record<string, string> = { USD: "$", EUR: "€" };
/** "$ 3,42 · € 3,05" para un monto en moneda local; vacio si aun no hay tasas. */
function eq(local: number): string {
	return ["USD", "EUR"]
		.filter((c) => payments.rateOf(c) > 0)
		.map((c) => `${SYMBOL[c]} ${fx(payments.equivalent(local, c))}`)
		.join(" · ");
}
const dueEq = computed(() => eq(payments.payable));
const changeEq = computed(() => eq(payments.change));
const leftEq = computed(() => eq(payments.outstanding > 0 ? payments.outstanding : payments.change));

/** Credit only shows when the profile allows it and the customer actually has some. */
const canUseCredit = computed(
	() => !isReturn.value && !!session.profile?.use_customer_credit && payments.credit.length > 0,
);
const mpesaEnabled = computed(() => !!session.profile?.posa_allow_mpesa_reconcile_payments);
/** Loyalty redemption shows whenever the customer carries a balance to spend. */
const canRedeem = computed(
	() =>
		!isReturn.value &&
		toNumber(cart.customerInfo?.loyalty_points) > 0 &&
		toNumber(cart.customerInfo?.conversion_factor) > 0,
);

// Totals can settle after entry (taxes arriving with the draft save); while the
// cashier has not touched the amounts, keep tender pinned to what is owed.
watch(
	() => payments.payable,
	() => {
		if (!done.value && !payments.touched) payments.tenderExact();
	},
);

// Credit belongs to a customer, so a stale list would offer somebody else's money.
watch(
	() => cart.customer,
	() => void payments.loadCredit(),
	{ immediate: true },
);

function back() {
	ui.setWorkspace("catalog");
}

async function complete() {
	const result = await payments.submit();
	if (!result) return;
	// Keep the receipt on screen; the cart is cleared when the cashier moves on.
	offers.reset();
}

function nextSale() {
	cart.reset();
	payments.reset();
	offers.reset();
	ui.setWorkspace("catalog");
}

function commitRedemption(event: Event) {
	const raw = (event.target as HTMLInputElement).value.trim();
	cart.setLoyaltyRedemption(toNumber(raw));
	payments.tenderExact();
}

/** Open the in-page print dialog; the browser's print sheet stays over this view. */
function print() {
	const name = payments.lastInvoice?.name as string | undefined;
	if (!name || queued.value) return;
	ui.openModal("print", { invoiceName: name });
}

function openMpesa() {
	ui.openModal("mpesa");
}
</script>

<template>
	<section class="panel flex h-full min-h-0 flex-col overflow-hidden">
		<!-- Success state -->
		<div v-if="done" class="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
			<span
				class="grid size-16 place-items-center rounded-full animate-pop-in"
				:class="queued ? 'bg-warning-soft text-warning' : 'bg-success-soft text-success'"
			>
				<CloudOff v-if="queued" class="size-8" />
				<CheckCircle2 v-else class="size-8" />
			</span>
			<div>
				<h2 class="text-lg font-semibold">
					{{ queued ? "Guardada en esta terminal" : isReturn ? "Reembolso completado" : "Venta completada" }}
				</h2>
				<p v-if="queued" class="mx-auto mt-1 max-w-[19rem] text-xs text-muted">
					No hay conexión, así que esta venta queda en espera en la caja. Se envía sola en
					cuanto vuelva la red: recibe el dinero y entrega la mercancía.
				</p>
				<p v-else class="mt-0.5 font-mono text-xs text-subtle">{{ payments.lastInvoice?.name }}</p>
			</div>

			<div v-if="payments.change > 0" class="panel bg-surface-2 px-6 py-4">
				<p class="text-xs font-medium uppercase tracking-wide text-subtle">
					{{ isReturn ? "Reembolso en exceso" : "Vuelto a entregar" }}
				</p>
				<p class="mt-0.5 text-3xl font-bold tnum text-warning">{{ formatCurrency(payments.change) }}</p>
				<p v-if="changeEq" class="mt-1 text-xs tnum text-subtle">≈ {{ changeEq }}</p>
			</div>

			<div class="mt-2 flex w-full max-w-xs flex-col gap-2">
				<button
					type="button"
					class="flex h-11 items-center justify-center gap-2 rounded-card bg-accent font-semibold text-accent-fg transition hover:bg-accent-hover"
					@click="nextSale"
				>
					<Plus class="size-4" />
					Nueva venta
				</button>
				<button
					type="button"
					class="flex h-11 items-center justify-center gap-2 rounded-card border border-line font-medium text-muted transition hover:bg-surface-2 hover:text-fg disabled:cursor-not-allowed disabled:opacity-45"
					:disabled="queued"
					:title="queued ? 'Disponible cuando se haya enviado la venta' : undefined"
					@click="print"
				>
					<Printer class="size-4" />
					Imprimir recibo
				</button>
			</div>
		</div>

		<!-- Tender state -->
		<template v-else>
			<header class="flex shrink-0 items-center gap-2 border-b border-line p-3">
				<button
					type="button"
					class="grid size-9 place-items-center rounded-card text-muted transition hover:bg-surface-2 hover:text-fg"
					aria-label="Volver al catálogo"
					@click="back"
				>
					<ArrowLeft class="size-4.5" />
				</button>
				<h2 class="text-sm font-semibold">{{ isReturn ? "Reembolso" : "Pago" }}</h2>
				<span class="ml-auto text-right">
					<span class="block text-[11px] uppercase tracking-wide text-subtle">
						{{ isReturn ? "Reembolso pendiente" : "Por pagar" }}
					</span>
					<span
						class="block text-lg font-bold tnum leading-tight"
						:class="isReturn && 'text-danger'"
						>{{ formatCurrency(Math.abs(payments.payable)) }}</span
					>
					<span v-if="dueEq" class="block text-[11px] tnum text-subtle">≈ {{ dueEq }}</span>
				</span>
			</header>

			<div class="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
				<!-- Modes -->
				<div class="space-y-2">
					<div
						v-for="row in payments.rows"
						:key="row.mode_of_payment"
						class="flex items-center gap-2 rounded-card border border-line bg-surface p-2 shadow-xs transition focus-within:border-accent"
					>
						<span class="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted">
							<Banknote class="size-4" />
						</span>
						<label class="min-w-0 flex-1 text-sm font-medium" :for="`pay-${row.mode_of_payment}`">
							<span class="block truncate">{{ row.mode_of_payment }}</span>
							<span
								v-if="payments.isForeign(row.mode_of_payment)"
								class="block text-[11px] font-normal tnum text-subtle"
							>
								{{ payments.currencyOf(row.mode_of_payment) }} · tasa
								{{ fx(payments.rateOf(payments.currencyOf(row.mode_of_payment))) }}
								<template v-if="row.foreign"> · = {{ formatCurrency(Math.abs(row.amount)) }}</template>
							</span>
						</label>
						<input
							:id="`pay-${row.mode_of_payment}`"
							:value="payments.isForeign(row.mode_of_payment) ? (row.foreign ? Math.abs(row.foreign) : '') : (row.amount ? Math.abs(row.amount) : '')"
							type="text"
							inputmode="decimal"
							placeholder="0.00"
							class="h-10 w-32 rounded-card border-line bg-surface-2 text-right text-base font-semibold tnum focus:border-accent focus:ring-0"
							@focus="($event.target as HTMLInputElement).select()"
							@input="payments.setAmount(row.mode_of_payment, toNumber(($event.target as HTMLInputElement).value))"
						/>
						<button
							v-if="payments.isForeign(row.mode_of_payment)"
							type="button"
							class="h-10 shrink-0 rounded-card border border-accent bg-accent-soft px-2 text-xs font-semibold text-accent transition hover:opacity-85"
							@click="payments.tenderExactIn(row.mode_of_payment)"
						>
							Exacto
						</button>
					</div>
				</div>

				<!-- Loyalty redemption — points settle part of the total before cash -->
				<div
					v-if="canRedeem"
					class="flex items-center gap-2 rounded-card border border-dashed border-violet/40 bg-violet-soft/40 p-2"
				>
					<span class="grid size-9 shrink-0 place-items-center rounded-lg bg-violet-soft text-violet">
						<Coins class="size-4" />
					</span>
					<label class="min-w-0 flex-1 text-sm font-medium" for="loyalty-redeem">
						Canjear puntos de lealtad
						<span class="block text-[11px] font-normal text-subtle">
							{{ formatFloat(cart.customerInfo?.loyalty_points ?? 0, 0) }} pts disponibles ·
							{{ formatCurrency(cart.maxLoyaltyAmount) }}
						</span>
					</label>
					<input
						id="loyalty-redeem"
						:value="cart.loyaltyAmount || ''"
						type="text"
						inputmode="decimal"
						placeholder="0.00"
						class="h-10 w-28 rounded-card border-line bg-surface text-right text-sm font-semibold tnum focus:border-accent focus:ring-0"
						@focus="($event.target as HTMLInputElement).select()"
						@change="commitRedemption($event)"
					/>
				</div>

				<!-- Customer credit — unapplied credit notes and advances on the account -->
				<div v-if="canUseCredit" class="space-y-2 rounded-card border border-info/40 bg-info-soft/40 p-2">
					<div class="flex items-center gap-2">
						<span class="grid size-9 shrink-0 place-items-center rounded-lg bg-info-soft text-info">
							<WalletCards class="size-4" />
						</span>
						<div class="min-w-0 flex-1">
							<p class="text-sm font-medium">Crédito del cliente</p>
							<p class="text-[11px] text-subtle">
								{{ formatCurrency(payments.creditAvailable) }} disponible ·
								{{ formatCurrency(payments.creditApplied) }} aplicado
							</p>
						</div>
						<button
							type="button"
							class="h-8 rounded-card border border-info px-2.5 text-xs font-semibold text-info transition hover:opacity-85"
							@click="payments.applyMaxCredit()"
						>
							Usar máximo
						</button>
						<button
							v-if="payments.creditApplied > 0"
							type="button"
							class="h-8 rounded-card px-2 text-xs font-medium text-subtle transition hover:text-danger"
							@click="payments.clearCredit()"
						>
							Limpiar
						</button>
					</div>

					<div
						v-for="row in payments.credit"
						:key="row.credit_origin"
						class="flex items-center gap-2 ps-11"
					>
						<label class="min-w-0 flex-1 truncate text-xs" :for="`credit-${row.credit_origin}`">
							<span class="font-medium">{{ CREDIT_TYPE_LABELS[row.type] ?? row.type }}</span>
							<span class="ms-1 font-mono text-subtle">{{ row.credit_origin }}</span>
							<span class="ms-1 tnum text-subtle">· {{ formatCurrency(row.total_credit) }}</span>
						</label>
						<input
							:id="`credit-${row.credit_origin}`"
							:value="row.credit_to_redeem || ''"
							type="text"
							inputmode="decimal"
							placeholder="0.00"
							class="h-9 w-24 rounded-card border-line bg-surface text-right text-sm font-semibold tnum focus:border-info focus:ring-0"
							@focus="($event.target as HTMLInputElement).select()"
							@change="payments.setCredit(row.credit_origin, toNumber(($event.target as HTMLInputElement).value))"
						/>
					</div>
				</div>

				<!-- M-Pesa: reconcile a transaction the customer has already sent -->
				<button
					v-if="mpesaEnabled"
					type="button"
					class="flex w-full items-center gap-2 rounded-card border border-dashed border-success/50 bg-success-soft/30 p-2 text-left transition hover:border-success"
					@click="openMpesa"
				>
					<span class="grid size-9 shrink-0 place-items-center rounded-lg bg-success-soft text-success">
						<Smartphone class="size-4" />
					</span>
					<span class="min-w-0 flex-1">
						<span class="block text-sm font-medium">M-Pesa</span>
						<span class="block text-[11px] text-subtle">Asocia una transacción que el cliente ya pagó</span>
					</span>
				</button>

				<!-- Quick cash -->
				<div>
					<p class="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-subtle">Agregar rápido</p>
					<div class="flex flex-wrap gap-1.5">
						<button
							v-for="amount in QUICK"
							:key="amount"
							type="button"
							class="h-9 min-w-14 rounded-card border border-line bg-surface px-3 text-sm font-semibold tnum shadow-xs transition hover:border-accent hover:text-accent"
							@click="payments.addAmount(payments.rows.find((r) => r.default)?.mode_of_payment ?? payments.rows[0]?.mode_of_payment ?? '', amount)"
						>
							+{{ amount }}
						</button>
						<button
							type="button"
							class="h-9 rounded-card border border-accent bg-accent-soft px-3 text-sm font-semibold text-accent transition hover:opacity-85"
							@click="payments.tenderExact()"
						>
							Exacto
						</button>
						<button
							type="button"
							class="h-9 rounded-card border border-line px-3 text-sm font-medium text-muted transition hover:bg-surface-2"
							@click="payments.clear()"
						>
							Limpiar
						</button>
					</div>
				</div>
			</div>

			<!-- Balance + complete -->
			<footer class="shrink-0 space-y-2 border-t border-line p-3">
				<div v-if="payments.igtf" class="flex justify-between text-sm">
					<span class="text-muted">IGTF {{ payments.igtfRate }}% sobre lo pagado en divisa</span>
					<span class="font-semibold tnum">{{ formatCurrency(Math.abs(payments.igtf)) }}</span>
				</div>
				<div class="flex justify-between text-sm">
					<span class="text-muted">{{ isReturn ? "Reembolsado" : "Recibido" }}</span>
					<span class="font-semibold tnum">{{ formatCurrency(Math.abs(payments.paid)) }}</span>
				</div>
				<div class="flex justify-between text-sm">
					<span :class="payments.outstanding > 0 ? 'text-danger' : 'text-muted'">
						{{
							payments.outstanding > 0
								? isReturn
									? "Falta por reembolsar"
									: "Falta por cobrar"
								: isReturn
									? "Reembolso en exceso"
									: "Vuelto"
						}}
					</span>
					<span
						class="font-bold tnum"
						:class="payments.outstanding > 0 ? 'text-danger' : 'text-success'"
					>
						{{ formatCurrency(payments.outstanding > 0 ? payments.outstanding : payments.change) }}
					</span>
				</div>
				<p v-if="leftEq" class="-mt-1 text-right text-[11px] tnum text-subtle">≈ {{ leftEq }}</p>

				<button
					type="button"
					class="flex h-13 w-full items-center justify-center gap-2 rounded-card text-base font-semibold text-white shadow-md transition hover:opacity-90 disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-subtle disabled:shadow-none"
					:class="isReturn ? 'bg-danger' : 'bg-success'"
					:disabled="!payments.canSubmit"
					@click="complete"
				>
					<Loader2 v-if="payments.submitting" class="size-5 animate-spin" />
					<Check v-else class="size-5" />
					{{
						payments.submitting
							? isReturn
								? "Reembolsando…"
								: "Completando…"
							: isReturn
								? "Completar reembolso"
								: "Completar venta"
					}}
				</button>
			</footer>
		</template>
	</section>
</template>
