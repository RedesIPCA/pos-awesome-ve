"""Install / migrate hooks.

Custom fields that predate v16 ship as fixtures. Anything introduced for v16 is
created here instead, so an existing site picks it up on `bench migrate` without
needing the fixture file to be re-imported.
"""

import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

V16_CUSTOM_FIELDS = {
	"Sales Invoice": [
		{
			"fieldname": "posa_offline_uuid",
			"label": "POS Offline Sync ID",
			"fieldtype": "Data",
			"insert_after": "posa_pos_opening_shift",
			"read_only": 1,
			"hidden": 1,
			"no_copy": 1,
			"unique": 1,
			"search_index": 1,
			"print_hide": 1,
			"description": (
				"Client-generated id for an invoice captured offline. Enforces "
				"exactly-once sync when a terminal replays its queue."
			),
		},
	],
	"POS Profile": [
		{
			"fieldname": "posa_offline_section",
			"label": "Offline Mode",
			"fieldtype": "Section Break",
			"insert_after": "posa_server_cache_duration",
			"collapsible": 1,
		},
		{
			"fieldname": "posa_allow_offline_mode",
			"label": "Allow Offline Mode",
			"fieldtype": "Check",
			"insert_after": "posa_offline_section",
			"default": "0",
			"description": (
				"Cache the catalog on the terminal and keep taking sales while the "
				"network is down. Queued invoices sync when the connection returns."
			),
		},
		{
			"fieldname": "posa_offline_cache_ttl",
			"label": "Offline Cache Refresh (minutes)",
			"fieldtype": "Int",
			"insert_after": "posa_allow_offline_mode",
			"default": "60",
			"depends_on": "eval:doc.posa_allow_offline_mode",
		},
		{
			"fieldname": "posa_offline_column_break",
			"fieldtype": "Column Break",
			"insert_after": "posa_offline_cache_ttl",
		},
		{
			"fieldname": "posa_offline_max_queue",
			"label": "Max Queued Invoices",
			"fieldtype": "Int",
			"insert_after": "posa_offline_column_break",
			"default": "200",
			"depends_on": "eval:doc.posa_allow_offline_mode",
			"description": "Stop accepting offline sales once this many invoices are waiting to sync.",
		},
	],
}


# --- Localizacion Venezuela: cobro en divisa, arqueo por moneda y estado por caja ----------
# Los usa el POS (stores/payments.ts, CloseShiftView.vue) y api/shift.py, asi que viajan con el
# fork. No se borran al desinstalar: guardan datos contables de facturas ya emitidas (la divisa
# recibida en cada pago). Para dejar una empresa lista ver posawesome/ve_setup.py.
ESTADOS_VE = [
	"Amazonas",
	"Anzoategui",
	"Apure",
	"Aragua",
	"Barinas",
	"Bolivar",
	"Carabobo",
	"Cojedes",
	"Delta Amacuro",
	"Distrito Capital",
	"Falcon",
	"Guarico",
	"La Guaira",
	"Lara",
	"Merida",
	"Miranda",
	"Monagas",
	"Nueva Esparta",
	"Portuguesa",
	"Sucre",
	"Tachira",
	"Trujillo",
	"Yaracuy",
	"Zulia",
]

VE_CUSTOM_FIELDS = {
	"Mode of Payment": [
		{
			"fieldname": "ve_moneda",
			"label": "Moneda de cobro",
			"fieldtype": "Select",
			"options": "VES\nUSD\nEUR",
			"default": "VES",
			"insert_after": "type",
			"description": (
				"Moneda en que el cliente entrega este medio de pago. "
				"Si no es VES, el POS convierte a la tasa del dia."
			),
		},
	],
	"Sales Invoice Payment": [
		{
			"fieldname": "ve_moneda",
			"label": "Moneda recibida",
			"fieldtype": "Data",
			"insert_after": "amount",
			"read_only": 1,
			"no_copy": 1,
		},
		{
			"fieldname": "ve_monto_divisa",
			"label": "Monto en divisa",
			"fieldtype": "Float",
			"precision": "2",
			"insert_after": "ve_moneda",
			"read_only": 1,
			"no_copy": 1,
		},
		{
			"fieldname": "ve_tasa",
			"label": "Tasa aplicada",
			"fieldtype": "Float",
			"precision": "6",
			"insert_after": "ve_monto_divisa",
			"read_only": 1,
			"no_copy": 1,
		},
	],
	"POS Profile": [
		{
			"fieldname": "ve_estado",
			"label": "Estado (ubicacion de la caja)",
			"fieldtype": "Select",
			"options": "\n" + "\n".join(ESTADOS_VE),
			"insert_after": "warehouse",
		},
	],
}


def ensure_ve_custom_fields():
	"""Crea (o deja igual) los campos ve_*; idempotente."""
	create_custom_fields(VE_CUSTOM_FIELDS, ignore_validate=True)


def after_install():
	create_custom_fields(V16_CUSTOM_FIELDS, ignore_validate=True)
	ensure_ve_custom_fields()
	frappe.db.commit()


def after_migrate():
	create_custom_fields(V16_CUSTOM_FIELDS, ignore_validate=True)
	ensure_ve_custom_fields()
	frappe.db.commit()
