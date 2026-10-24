<script setup lang="ts">
/** Create or edit a customer without leaving the till. */
import { onMounted, ref } from "vue";
import { Gift, Loader2, UserPlus } from "lucide-vue-next";
import { useCustomerStore } from "@/stores/customers";
import { useCartStore } from "@/stores/cart";
import { useUiStore } from "@/stores/ui";
import { useSessionStore } from "@/stores/session";
import { api } from "@/lib/api";

const props = defineProps<{ customerId?: string }>();

const customers = useCustomerStore();
const cart = useCartStore();
const ui = useUiStore();
const session = useSessionStore();

/** Estados de Venezuela; mismos valores que el campo Estado del POS Profile. */
const ESTADOS = ["Amazonas","Anzoategui","Apure","Aragua","Barinas","Bolivar","Carabobo","Cojedes","Delta Amacuro","Distrito Capital","Falcon","Guarico","La Guaira","Lara","Merida","Miranda","Monagas","Nueva Esparta","Portuguesa","Sucre","Tachira","Trujillo","Yaracuy","Zulia"];
const PAIS = "Venezuela, Bolivarian Republic of";
const groups = ref<string[]>([]);

const form = ref({
	customer_name: "",
	mobile_no: "",
	email_id: "",
	tax_id: "",
	gender: "",
	customer_type: "Individual",
	birthday: "",
	customer_group: "",
	address_line1: "",
	city: "",
	/** Estado de la caja por defecto; el cajero puede cambiarlo. */
	state: session.profile?.ve_estado ?? "",
	/** Someone else's code, entered when this customer was referred in.
	 *  Named for the endpoint's argument, not the stored fieldname — save_customer
	 *  maps `referral_code` onto Customer.posa_referral_code. */
	referral_code: "",
});
const saving = ref(false);
/** This customer's own code, created by the server on insert. Read-only. */
const ownReferralCode = ref("");
const copied = ref(false);

onMounted(async () => {
	try {
		groups.value = (await api.customerGroups()).map((g) => g.name);
	} catch {
		groups.value = [];
	}
	if (!props.customerId) return;
	const info = await customers.info(props.customerId);
	if (!info) return;
	form.value = {
		customer_name: info.customer_name ?? "",
		mobile_no: info.mobile_no ?? "",
		email_id: info.email_id ?? "",
		tax_id: info.tax_id ?? "",
		gender: info.gender ?? "",
		customer_type: info.customer_type ?? "Individual",
		birthday: info.birthday ?? "",
		customer_group: (info as unknown as Record<string, string>).customer_group ?? "",
		address_line1: "",
		city: "",
		state: "",
		referral_code: "",
	};
	// Shown rather than edited: the code is issued by the server, and overtyping it
	// would orphan every coupon already given out against it.
	ownReferralCode.value = info.posa_referral_code ?? "";
});

async function copyCode() {
	if (!ownReferralCode.value) return;
	try {
		await navigator.clipboard.writeText(ownReferralCode.value);
		copied.value = true;
		setTimeout(() => (copied.value = false), 1500);
	} catch {
		ui.warn("No se pudo copiar", "Dicta el código en su lugar.");
	}
}

async function save() {
	if (!form.value.customer_name.trim()) {
		ui.warn("El nombre del cliente es obligatorio");
		return;
	}
	saving.value = true;
	try {
		// An empty referral code is omitted rather than sent blank: save_customer
		// writes through any value that is not None, so posting "" on an edit would
		// wipe a code the customer was already referred in on.
		const { referral_code, customer_group, address_line1, city, state, ...rest } = form.value;
		rest.tax_id = rest.tax_id.trim().toUpperCase();
		const payload: Record<string, unknown> = { ...rest, customer_id: props.customerId };
		if (customer_group) payload.customer_group = customer_group;
		if (referral_code.trim()) payload.referral_code = referral_code.trim().toUpperCase();

		const result = await customers.save(payload);
		// Direccion: solo al crear. El cliente ya existe; si la direccion falla no se pierde.
		if (!props.customerId && (address_line1.trim() || city.trim() || state)) {
			try {
				await api.makeAddress({
					customer: result.name,
					address_title: result.customer_name,
					address_type: "Billing",
					address_line1: address_line1.trim() || city.trim() || state,
					city: city.trim() || undefined,
					state: state || undefined,
					country: PAIS,
				});
			} catch (error) {
				ui.warn("Cliente creado, pero no se guardo la direccion", error instanceof Error ? error.message : String(error));
			}
		}
		// Selecting the new customer is almost always what the cashier wants next.
		cart.customer = result.name;
		cart.customerInfo = result;
		ui.success(props.customerId ? "Cliente actualizado" : "Cliente creado", result.customer_name);
		ui.closeModal();
	} catch (error) {
		ui.fail("No se pudo guardar el cliente", error instanceof Error ? error.message : String(error));
	} finally {
		saving.value = false;
	}
}
</script>

<template>
	<ModalShell
		:title="customerId ? 'Editar cliente' : 'Nuevo cliente'"
		width="max-w-md"
		@close="ui.closeModal()"
	>
		<form id="customer-form" class="grid gap-3 p-4 sm:grid-cols-2" @submit.prevent="save">
			<label class="block sm:col-span-2">
				<span class="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-subtle">Nombre</span>
				<input
					v-model="form.customer_name"
					type="text"
					required
					class="h-10 w-full rounded-card border-line bg-surface text-sm focus:border-accent focus:ring-0"
				/>
			</label>
			<label class="block">
				<span class="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-subtle">Telefono</span>
				<input
					v-model="form.mobile_no"
					type="tel"
					class="h-10 w-full rounded-card border-line bg-surface text-sm focus:border-accent focus:ring-0"
				/>
			</label>
			<label class="block">
				<span class="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-subtle">Correo</span>
				<input
					v-model="form.email_id"
					type="email"
					class="h-10 w-full rounded-card border-line bg-surface text-sm focus:border-accent focus:ring-0"
				/>
			</label>
			<label class="block">
				<span class="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-subtle">RIF</span>
				<input
					v-model="form.tax_id"
					type="text"
					placeholder="J-12345678-9"
					autocapitalize="characters"
					class="h-10 w-full rounded-card border-line bg-surface text-sm focus:border-accent focus:ring-0"
				/>
			</label>
			<label class="block">
				<span class="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-subtle">Tipo</span>
				<select
					v-model="form.customer_type"
					class="h-10 w-full rounded-card border-line bg-surface text-sm focus:border-accent focus:ring-0"
				>
					<option value="Individual">Persona natural</option>
					<option value="Company">Empresa / Juridica</option>
				</select>
			</label>
			<label class="block">
				<span class="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-subtle">Sexo</span>
				<select
					v-model="form.gender"
					class="h-10 w-full rounded-card border-line bg-surface text-sm focus:border-accent focus:ring-0"
				>
					<option value="">—</option>
					<option value="Male">Masculino</option>
					<option value="Female">Femenino</option>
					<option value="Other">Otro</option>
				</select>
			</label>
			<label class="block">
				<span class="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-subtle">Fecha de nacimiento</span>
				<input
					v-model="form.birthday"
					type="date"
					class="h-10 w-full rounded-card border-line bg-surface text-sm focus:border-accent focus:ring-0"
				/>
			</label>

			<label class="block">
				<span class="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-subtle">Categoria</span>
				<select
					v-model="form.customer_group"
					class="h-10 w-full rounded-card border-line bg-surface text-sm focus:border-accent focus:ring-0"
				>
					<option value="">Por defecto</option>
					<option v-for="g in groups" :key="g" :value="g">{{ g }}</option>
				</select>
			</label>

			<template v-if="!props.customerId">
				<label class="block sm:col-span-2">
					<span class="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-subtle">Direccion</span>
					<input
						v-model="form.address_line1"
						type="text"
						class="h-10 w-full rounded-card border-line bg-surface text-sm focus:border-accent focus:ring-0"
					/>
				</label>
				<label class="block">
					<span class="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-subtle">Ciudad</span>
					<input
						v-model="form.city"
						type="text"
						class="h-10 w-full rounded-card border-line bg-surface text-sm focus:border-accent focus:ring-0"
					/>
				</label>
				<label class="block">
					<span class="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-subtle">Estado</span>
					<select
						v-model="form.state"
						class="h-10 w-full rounded-card border-line bg-surface text-sm focus:border-accent focus:ring-0"
					>
						<option value="">—</option>
						<option v-for="s in ESTADOS" :key="s" :value="s">{{ s }}</option>
					</select>
				</label>
			</template>

			<!-- Referrals. A code entered here credits whoever sent this customer in;
			     the code below is this customer's own, for them to pass on. -->
			<label v-if="!props.customerId" class="block sm:col-span-2">
				<span class="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-subtle">
					Referido por (código)
				</span>
				<input
					v-model="form.referral_code"
					type="text"
					autocapitalize="characters"
					placeholder="Opcional"
					class="h-10 w-full rounded-card border-line bg-surface text-sm font-mono uppercase focus:border-accent focus:ring-0"
				/>
			</label>

			<div v-if="ownReferralCode" class="sm:col-span-2">
				<span class="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-subtle">
					Su código de referido
				</span>
				<div class="flex items-center gap-2 rounded-card border border-line bg-surface-2 p-2">
					<Gift class="size-4 shrink-0 text-violet" />
					<span class="min-w-0 flex-1 truncate font-mono text-sm font-semibold">
						{{ ownReferralCode }}
					</span>
					<button
						type="button"
						class="h-8 shrink-0 rounded-card border border-line bg-surface px-2.5 text-xs font-semibold transition hover:border-accent hover:text-accent"
						@click="copyCode"
					>
						{{ copied ? "Copiado" : "Copiar" }}
					</button>
				</div>
			</div>
		</form>

		<template #footer>
			<button
				type="submit"
				form="customer-form"
				class="flex h-11 w-full items-center justify-center gap-2 rounded-card bg-accent font-semibold text-accent-fg transition hover:bg-accent-hover disabled:bg-surface-3 disabled:text-subtle"
				:disabled="saving"
			>
				<Loader2 v-if="saving" class="size-4 animate-spin" />
				<UserPlus v-else class="size-4" />
				{{ customerId ? "Guardar cambios" : "Crear cliente" }}
			</button>
		</template>
	</ModalShell>
</template>

<script lang="ts">
import ModalShell from "@/components/common/ModalShell.vue";
export default { components: { ModalShell } };
</script>
