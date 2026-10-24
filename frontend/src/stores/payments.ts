/**
 * Tender state for the sale being closed.
 *
 * Rows mirror the profile's modes of payment. The cashier fills amounts; this
 * store derives what is still owed and what change is due, and owns the actual
 * submit so no component has to know the invoice payload shape.
 */
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { api } from "@/lib/api";
import { money, round, toNumber } from "@/lib/format";
import type { CreditRow, PaymentMethod } from "@/types";
import { useCartStore } from "./cart";
import { useSessionStore } from "./session";
import { useSyncStore } from "./sync";
import { useUiStore } from "./ui";

export interface TenderRow {
	mode_of_payment: string;
	amount: number;
	account?: string;
	type?: string;
	default: boolean;
	/** Monto recibido en la divisa de esta forma de pago; 0 si cobra en moneda local. */
	foreign: number;
}

export const usePaymentsStore = defineStore("payments", () => {
	const session = useSessionStore();
	const cart = useCartStore();
	const sync = useSyncStore();
	const ui = useUiStore();

	const rows = ref<TenderRow[]>([]);
	/** Credit notes and advances the customer can spend on this sale. */
	const credit = ref<CreditRow[]>([]);
	const loadingCredit = ref(false);
	const submitting = ref(false);
	/** True once the cashier edits amounts by hand — auto-tender then stands down. */
	const touched = ref(false);
	/** The invoice that was just completed, for the success panel and reprint. */
	const lastInvoice = ref<Record<string, unknown> | null>(null);

	/* ---- Multimoneda -------------------------------------------------------
	 * `row.amount` SIEMPRE es moneda local (VES): es lo que viaja a ERPNext y lo que
	 * cuenta para saldo y vuelto. Si la forma de pago es en divisa, el cajero digita
	 * lo recibido en esa divisa (`row.foreign`) y aqui se convierte a la tasa del dia. */
	/** Cuantos VES vale 1 unidad de cada divisa (tasa del dia). */
	const rates = ref<Record<string, number>>({});
	/** Moneda en la que el cliente entrega cada forma de pago (campo ve_moneda). */
	const modeCurrency = ref<Record<string, string>>({});
	let ratesLoadedAt = 0;
	/** Tasa de IGTF en %, de erpnext_ve; 0 si no esta instalado. */
	const igtfRate = ref(0);
	const IGTF_KEY = "posa_ve_igtf";
	const RATES_KEY = "posa_ve_rates";

	function currencyOf(mode: string): string {
		return modeCurrency.value[mode] || session.currency;
	}
	function rateOf(currency: string): number {
		if (currency === session.currency) return 1;
		return toNumber(rates.value[currency]) || 0;
	}
	function isForeign(mode: string): boolean {
		const currency = currencyOf(mode);
		return currency !== session.currency && rateOf(currency) > 0;
	}
	/** Monto en moneda local expresado en otra moneda, a la tasa del dia. */
	function equivalent(local: number, currency: string): number {
		const rate = rateOf(currency);
		return rate > 0 ? money(Math.abs(local) / rate) : 0;
	}
	async function loadRates(force = false) {
		const fresh = Date.now() - ratesLoadedAt < 15 * 60 * 1000;
		if (!force && fresh && Object.keys(rates.value).length) return;
		try {
			igtfRate.value = toNumber(await api.igtfRate());
			try {
				localStorage.setItem(IGTF_KEY, String(igtfRate.value));
			} catch {
				/* sin almacenamiento local */
			}
		} catch {
			// Sin conexion o sin erpnext_ve: ultima tasa conocida de este equipo.
			try {
				igtfRate.value = toNumber(localStorage.getItem(IGTF_KEY) ?? 0);
			} catch {
				igtfRate.value = 0;
			}
		}
		try {
			const modes = await api.modesOfPayment();
			const map: Record<string, string> = {};
			for (const mode of modes ?? []) if (mode.ve_moneda) map[mode.name] = mode.ve_moneda;
			const wanted = new Set<string>(["USD", "EUR", ...Object.values(map)]);
			wanted.delete(session.currency);
			const next: Record<string, number> = {};
			for (const currency of wanted) {
				next[currency] = toNumber(await api.exchangeRate(currency, session.currency));
			}
			modeCurrency.value = map;
			rates.value = next;
			ratesLoadedAt = Date.now();
			try {
				localStorage.setItem(RATES_KEY, JSON.stringify({ map, next }));
			} catch {
				/* sin almacenamiento local */
			}
		} catch {
			// Sin conexion: se usan las ultimas tasas conocidas de este equipo.
			if (Object.keys(rates.value).length) return;
			try {
				const cached = JSON.parse(localStorage.getItem(RATES_KEY) ?? "null");
				if (cached) {
					modeCurrency.value = cached.map;
					rates.value = cached.next;
				}
			} catch {
				/* nada guardado */
			}
		}
	}

	/** +1 on a sale, -1 on a return. Money flows the other way on a credit note,
	 *  so every comparison below has to be taken relative to this. */
	const sign = computed(() => (cart.isReturn ? -1 : 1));

	const paid = computed(() => money(rows.value.reduce((sum, row) => sum + toNumber(row.amount), 0)));
	/** Credit the cashier has chosen to spend on this sale. */
	const creditApplied = computed(() =>
		cart.isReturn
			? 0
			: money(credit.value.reduce((sum, row) => sum + toNumber(row.credit_to_redeem), 0)),
	);
	const creditAvailable = computed(() =>
		money(credit.value.reduce((sum, row) => sum + toNumber(row.total_credit), 0)),
	);
	/** Redemption covers part of the total before any cash is counted. */
	const redeemed = computed(() =>
		cart.isReturn ? 0 : money(toNumber(cart.loyaltyAmount) + creditApplied.value),
	);
	/** Precio de la factura por cobrar, sin IGTF. */
	const priceDue = computed(() => {
		const gross = cart.payableAmount - redeemed.value;
		// Only a sale can never fall below zero. A refund's total is negative by
		// design, and clamping it to zero left nothing to tender — so `canSubmit`,
		// which wants a non-zero paid amount, refused every refund outright.
		return money(cart.isReturn ? gross : Math.max(gross, 0));
	});

	/** IGTF: solo sobre la parte del precio pagada en divisa, y se suma al precio como un impuesto mas.
	 *  Misma regla que erpnext_ve.events.igtf.apply_igtf: base = min(divisa recibida, precio sin IGTF). */
	const foreignPaid = computed(() =>
		rows.value.reduce((sum, row) => (isForeign(row.mode_of_payment) ? sum + Math.abs(toNumber(row.amount)) : sum), 0),
	);
	const igtf = computed(() => {
		if (!igtfRate.value) return 0;
		const price = cart.totals.grandTotal - redeemed.value;
		if (!price) return 0;
		const base = Math.min(foreignPaid.value, Math.abs(price));
		return money(sign.value * (igtfRate.value / 100) * base);
	});
	/** Total a cobrar: precio + IGTF, redondeado igual que el servidor (rounded_total). */
	const payable = computed(() => {
		if (!igtf.value) return priceDue.value;
		const exact = cart.totals.grandTotal - redeemed.value + igtf.value;
		return money(session.profile?.disable_rounded_total ? exact : round(exact, 0));
	});
	/** Signed shortfall: still owed on a sale, still to refund on a return. */
	const remaining = computed(() => money(payable.value - paid.value));
	/** Magnitude still outstanding, whichever way the money is moving. */
	const outstanding = computed(() => money(Math.max(sign.value * remaining.value, 0)));
	/** Over-tender: change owed to the customer, or an over-refund. */
	const change = computed(() => money(Math.max(sign.value * (paid.value - payable.value), 0)));
	const settled = computed(() => sign.value * remaining.value <= 0);
	const canSubmit = computed(
		() =>
			!cart.isEmpty &&
			!!cart.customer &&
			Math.abs(paid.value) > 0 &&
			settled.value &&
			!submitting.value,
	);

	function build() {
		rows.value = session.paymentMethods.map((method: PaymentMethod) => ({
			mode_of_payment: method.mode_of_payment,
			amount: 0,
			account: method.account,
			type: method.type,
			default: !!method.default,
			foreign: 0,
		}));
		touched.value = false;
	}

	function reset() {
		build();
		credit.value = [];
		lastInvoice.value = null;
	}

	/**
	 * Load the credit sitting on this customer's account.
	 *
	 * Unapplied credit notes and advance payments both count. The list is per
	 * customer, so it is reloaded whenever the customer on the ticket changes; a
	 * stale list would offer credit that belongs to somebody else.
	 */
	async function loadCredit() {
		credit.value = [];
		if (!cart.customer || !session.companyName) return;
		if (!session.profile?.use_customer_credit) return;
		loadingCredit.value = true;
		try {
			const rowsFromServer = (await api.availableCredit(
				cart.customer,
				session.companyName,
			)) as CreditRow[];
			credit.value = (rowsFromServer ?? []).map((row) => ({
				...row,
				total_credit: toNumber(row.total_credit),
				credit_to_redeem: 0,
			}));
		} catch {
			// Credit is an optional convenience; failing to read it must not stop a sale.
		} finally {
			loadingCredit.value = false;
		}
	}

	/** Spend an amount from one credit origin, capped at what it holds. */
	function setCredit(origin: string, value: number) {
		const row = credit.value.find((entry) => entry.credit_origin === origin);
		if (!row) return;
		const cap = toNumber(row.total_credit);
		row.credit_to_redeem = money(Math.min(Math.max(toNumber(value), 0), cap));
		// Credit changes what is left to tender, so any auto-tender has to run again.
		touched.value = false;
		clear();
		tenderExact();
	}

	/** Spend as much credit as the sale can absorb, oldest origin first. */
	function applyMaxCredit() {
		let room = money(Math.max(cart.payableAmount - toNumber(cart.loyaltyAmount), 0));
		for (const row of credit.value) {
			const take = money(Math.min(toNumber(row.total_credit), room));
			row.credit_to_redeem = take;
			room = money(room - take);
		}
		touched.value = false;
		clear();
		tenderExact();
	}

	function clearCredit() {
		for (const row of credit.value) row.credit_to_redeem = 0;
		touched.value = false;
		clear();
		tenderExact();
	}

	/** The cashier always types a positive magnitude; direction comes from the sale. */
	function setAmount(mode: string, value: number) {
		const row = rows.value.find((entry) => entry.mode_of_payment === mode);
		if (!row) return;
		const magnitude = Math.max(Math.abs(toNumber(value)), 0);
		if (isForeign(mode)) {
			// Lo digitado es la divisa recibida; el monto de la factura va en moneda local.
			row.foreign = money(sign.value * magnitude);
			row.amount = money(sign.value * magnitude * rateOf(currencyOf(mode)));
		} else {
			row.foreign = 0;
			row.amount = money(sign.value * magnitude);
		}
		if (cart.isReturn) {
			// Un reembolso no puede superar lo adeudado: ERPNext rechaza el sobre-reembolso.
			const others = rows.value.reduce((sum, r) => (r === row ? sum : sum + toNumber(r.amount)), 0);
			row.amount = money(Math.max(row.amount, payable.value - others));
		}
		touched.value = true;
	}

	function addAmount(mode: string, delta: number) {
		const row = rows.value.find((entry) => entry.mode_of_payment === mode);
		if (!row) return;
		if (isForeign(mode)) {
			setAmount(mode, Math.abs(row.foreign) + Math.abs(delta));
			return;
		}
		const magnitude = Math.max(Math.abs(row.amount) + Math.abs(delta), 0);
		row.amount = money(sign.value * magnitude);
		touched.value = true;
	}

	/** Drop the whole balance onto one mode — the common single-tender case. */
	function tenderExact(mode?: string) {
		const target =
			rows.value.find((row) => row.mode_of_payment === mode) ??
			rows.value.find((row) => row.default) ??
			rows.value[0];
		if (!target) return;
		clear();
		// Signed, not clamped: a return has to be able to tender a negative amount
		// or the refund can never be completed.
		target.amount = money(payable.value);
	}

	/** Cobra el saldo pendiente completo en la divisa de esa forma de pago (redondea al centimo hacia arriba). */
	function tenderExactIn(mode: string) {
		if (!isForeign(mode)) {
			tenderExact(mode);
			return;
		}
		const rate = rateOf(currencyOf(mode));
		clear();
		// El IGTF depende de lo pagado en divisa: se itera hasta que lo entregado cubra el total con IGTF.
		for (let attempt = 0; attempt < 5; attempt += 1) {
			const owed = Math.abs(payable.value);
			setAmount(mode, Math.ceil((owed / rate) * 100) / 100);
			const given = Math.abs(rows.value.find((row) => row.mode_of_payment === mode)?.amount ?? 0);
			if (Math.abs(payable.value) <= given + 0.005) break;
		}
	}

	function clear() {
		for (const row of rows.value) {
			row.amount = 0;
			row.foreign = 0;
		}
	}

	/** Offline-capable, and the thing that failed was the network rather than a rule. */
	function canQueue(error: unknown): boolean {
		return session.offlineEnabled && sync.isConnectivityFailure(error);
	}

	/** Everything `submit_invoice` would have received, built from local state. */
	function buildPayload(draftName?: string) {
		// Lo recibido en divisas queda anotado en la factura (la contabilidad va en moneda local).
		const foreignNote = rows.value
			.filter((row) => Math.abs(row.foreign) > 0)
			.map((row) => {
				const currency = currencyOf(row.mode_of_payment);
				return `${row.mode_of_payment}: ${Math.abs(row.foreign).toFixed(2)} ${currency} @ ${rateOf(currency)} = ${Math.abs(row.amount).toFixed(2)} ${session.currency}`;
			})
			.join(" | ");
		const invoice = {
			...cart.toInvoicePayload(),
			name: draftName,
			payments: rows.value
				// Magnitude, not sign: refund rows are negative and a `> 0` test
				// silently drops every one of them, leaving the invoice unpaid.
				.filter((row) => Math.abs(row.amount) > 0)
				.map((row) => ({
					mode_of_payment: row.mode_of_payment,
					amount: row.amount,
					account: row.account,
					type: row.type,
					default: row.default ? 1 : 0,
					// Divisa realmente recibida: permite arquear la gaveta en esa moneda.
					...(row.foreign
						? {
							  ve_moneda: currencyOf(row.mode_of_payment),
							  ve_monto_divisa: row.foreign,
							  ve_tasa: rateOf(currencyOf(row.mode_of_payment)),
						  }
						: {}),
				})),
			paid_amount: paid.value,
			change_amount: change.value,
			...(foreignNote ? { remarks: `Cobro en divisas: ${foreignNote}` } : {}),
		};

		const data: Record<string, unknown> = {
			due_date: cart.dueDate ?? undefined,
			redeemed_customer_credit: creditApplied.value || undefined,
			customer_credit_dict: creditApplied.value
				? credit.value.filter((row) => toNumber(row.credit_to_redeem) > 0)
				: undefined,
			// El vuelto se entrega en efectivo (change_amount). Enviar credit_change lo duplicaba
			// como anticipo a favor del cliente; no hay casilla para ello, asi que no se envia.
		};

		return { invoice, data };
	}

	/**
	 * Park a completed sale on the terminal.
	 *
	 * The money is in the drawer and the goods have gone, so this must not fail
	 * quietly — if even the local write fails there is nothing left holding the sale
	 * and the cashier has to be told.
	 */
	async function queueSale(invoice: Record<string, unknown>, data: Record<string, unknown>) {
		try {
			return await parkSale(invoice, data);
		} catch (error) {
			// Nothing is holding this sale now — not the server, not the terminal. The
			// cashier has to know before the customer walks away.
			ui.notify({
				title: "Esta venta NO se guardó",
				detail:
					"No hay conexión y esta terminal tampoco puede guardarla. No entregues la mercancía: anota la venta y regístrala de nuevo cuando vuelva la conexión.",
				tone: "danger",
				duration: 0,
			});
			throw error;
		}
	}

	async function parkSale(invoice: Record<string, unknown>, data: Record<string, unknown>) {
		const uuid = await sync.enqueue({
			invoice,
			data,
			summary: {
				customer: cart.customer,
				customer_name: cart.customerInfo?.customer_name ?? cart.customer,
				grand_total: payable.value,
				currency: session.currency,
				item_count: cart.itemCount,
			},
		});
		lastInvoice.value = { name: uuid, __queued: true };
		ui.warn(
			"Guardada en esta terminal",
			"Sin conexión. Se envía sola en cuanto vuelva la red: recibe el dinero y entrega la mercancía.",
		);
		return lastInvoice.value;
	}

	async function submit(): Promise<Record<string, unknown> | null> {
		if (!canSubmit.value) return null;
		submitting.value = true;
		try {
			// Settle the totals on the server when there is one: saving can move them
			// (first-time taxes, discount resolution), and tendering against a figure the
			// server is about to change is how "Pay" ends up rejecting a good sale.
			//
			// Offline there is nothing to settle against, so the local figures stand —
			// they come from the same arithmetic, and the server re-checks everything when
			// the queue drains.
			let draftName: string | undefined;
			try {
				const draft = await cart.saveDraft();
				draftName = draft?.name as string | undefined;
				if (!draftName) {
					ui.fail("No se pudo guardar la factura");
					return null;
				}
				if (!touched.value) {
					clear();
					tenderExact();
				}
			} catch (error) {
				// This is where an offline sale used to die: the draft save threw before
				// anything had a chance to queue, and the cashier saw a bare "Offline".
				if (!canQueue(error)) throw error;
				const parked = buildPayload();
				return await queueSale(parked.invoice, parked.data);
			}

			const { invoice, data } = buildPayload(draftName);

			let result: Record<string, unknown>;
			try {
				result = (await api.submitInvoice(invoice, data)) as Record<string, unknown>;
			} catch (error) {
				// Anything the server actually answered — negative stock, a permission
				// refusal — is a real decision and has to reach the cashier. Only a
				// transport failure is replayable.
				if (!canQueue(error)) throw error;
				return await queueSale(invoice, data);
			}

			lastInvoice.value = result;
			ui.success(
				cart.isReturn ? "Reembolso completado" : "Venta completada",
				`${result.name ?? draftName}${change.value ? ` · vuelto ${change.value}` : ""}`,
			);
			return result;
		} catch (error) {
			ui.fail(
				cart.isReturn ? "No se pudo completar el reembolso" : "No se pudo completar la venta",
				error instanceof Error ? error.message : String(error),
			);
			return null;
		} finally {
			submitting.value = false;
		}
	}

	return {
		rows,
		credit,
		loadingCredit,
		submitting,
		touched,
		lastInvoice,
		sign,
		paid,
		redeemed,
		creditApplied,
		creditAvailable,
		payable,
		remaining,
		outstanding,
		change,
		settled,
		canSubmit,
		build,
		reset,
		loadCredit,
		setCredit,
		applyMaxCredit,
		clearCredit,
		setAmount,
		addAmount,
		tenderExact,
		tenderExactIn,
		clear,
		submit,
		rates,
		modeCurrency,
		loadRates,
		currencyOf,
		rateOf,
		isForeign,
		equivalent,
		igtf,
		igtfRate,
		priceDue,
	};
});
