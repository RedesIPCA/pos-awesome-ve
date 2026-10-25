"""Deja una empresa lista para cobrar en divisa desde el POS (Venezuela).

``setup_pos_ve(company)`` es idempotente: se puede correr de nuevo sin duplicar nada. Para cada
forma de pago de ``FORMAS_DE_PAGO`` hace lo siguiente:

1. Crea su cuenta contable en la moneda de la EMPRESA (la contabilidad va en moneda local; la
   divisa recibida se registra en la fila de pago, ver ``ve_monto_divisa``). El grupo padre se
   busca por TIPO de cuenta (Cash / Bank), no por nombre, asi funciona con cualquier plan de
   cuentas (el de Venezuela, el estandar en ingles, etc.).
2. Crea el Mode of Payment con su ``ve_moneda`` y la cuenta de esa empresa. Si ya existia (por
   otra empresa del mismo sitio), le agrega la cuenta de esta empresa.
3. Habilita las monedas que usan esas formas de pago (USD/EUR).
4. Agrega las formas de pago a los POS Profile de la empresa y, si se indica ``estado``, lo
   asigna a los perfiles que no tengan uno.

Uso, en el servidor::

	bench --site SITIO execute posawesome.ve_setup.setup_pos_ve \
		--kwargs "{'company': 'Mi Empresa C.A.', 'estado': 'Miranda'}"

Ademas necesita una tasa USD->moneda local en Currency Exchange (ej. la del BCV) y, para el IGTF,
la app erpnext_ve. Ninguna de las dos la crea este script.

Nota: al crear una empresa NUEVA, ERPNext (Company.set_mode_of_payment_account) asigna su caja por
defecto a la primera forma de pago de tipo Cash. En un sitio normal esa es "Cash" (la crea el
asistente de ERPNext), pero si se corre este script ANTES de crear la empresa y no existe "Cash",
la tomaria "Efectivo EUR"; en ese caso hay que ajustar a mano la cuenta de esa fila.
"""

import frappe
from frappe import _

# (nombre, tipo en ERPNext, moneda de cobro; None = moneda de la empresa)
FORMAS_DE_PAGO = [
	("Efectivo USD", "Cash", "USD"),
	("Efectivo EUR", "Cash", "EUR"),
	("Punto de venta", "Bank", None),
	("Pago móvil", "Bank", None),
	("Zelle", "Bank", "USD"),
	("Transferencia", "Bank", None),
]


def setup_pos_ve(company, estado=None, perfiles=None, formas=None):
	"""Prepara ``company``; devuelve un resumen de lo que se creo o cambio."""
	from posawesome.install import ESTADOS_VE, ensure_ve_custom_fields

	if not frappe.db.exists("Company", company):
		frappe.throw(_("La empresa {0} no existe").format(company))
	if estado and estado not in ESTADOS_VE:
		frappe.throw(_("Estado no valido: {0}").format(estado))

	ensure_ve_custom_fields()
	abbr, moneda_local = frappe.get_cached_value("Company", company, ["abbr", "default_currency"])
	formas = formas or FORMAS_DE_PAGO
	resumen = {"empresa": company, "monedas": [], "cuentas": [], "formas_de_pago": [], "perfiles": []}

	for moneda in sorted({m for _n, _t, m in formas if m}):
		if frappe.db.exists("Currency", moneda) and not frappe.db.get_value("Currency", moneda, "enabled"):
			frappe.db.set_value("Currency", moneda, "enabled", 1)
			resumen["monedas"].append(moneda)

	for nombre, tipo, moneda in formas:
		cuenta, creada = _asegurar_cuenta(company, abbr, moneda_local, nombre, tipo)
		if creada:
			resumen["cuentas"].append(cuenta)
		if _asegurar_forma_de_pago(company, nombre, tipo, moneda or moneda_local, cuenta):
			resumen["formas_de_pago"].append(nombre)

	filtros = {"company": company, "disabled": 0}
	if perfiles:
		filtros["name"] = ["in", perfiles]
	for perfil in frappe.get_all("POS Profile", filters=filtros, pluck="name"):
		if _asignar_a_perfil(perfil, [n for n, _t, _m in formas], estado):
			resumen["perfiles"].append(perfil)

	frappe.db.commit()
	return resumen


def _asegurar_cuenta(company, abbr, moneda_local, nombre, tipo):
	cuenta = f"{nombre} - {abbr}"
	if frappe.db.exists("Account", cuenta):
		return cuenta, False
	padre = frappe.db.get_value(
		"Account",
		{"company": company, "account_type": tipo, "is_group": 1},
		"name",
		order_by="lft",
	)
	if not padre:
		frappe.throw(_("{0} no tiene un grupo de cuentas de tipo {1}").format(company, tipo))
	frappe.get_doc(
		{
			"doctype": "Account",
			"account_name": nombre,
			"company": company,
			"parent_account": padre,
			"account_type": tipo,
			"is_group": 0,
			"account_currency": moneda_local,
		}
	).insert()
	return cuenta, True


def _asegurar_forma_de_pago(company, nombre, tipo, moneda, cuenta):
	"""True si creo la forma de pago o le agrego la cuenta de esta empresa."""
	if not frappe.db.exists("Mode of Payment", nombre):
		frappe.get_doc(
			{
				"doctype": "Mode of Payment",
				"mode_of_payment": nombre,
				"type": tipo,
				"enabled": 1,
				"ve_moneda": moneda,
				"accounts": [{"company": company, "default_account": cuenta}],
			}
		).insert()
		return True
	forma = frappe.get_doc("Mode of Payment", nombre)
	if any(fila.company == company for fila in forma.accounts):
		return False
	forma.append("accounts", {"company": company, "default_account": cuenta})
	forma.save()
	return True


def _asignar_a_perfil(perfil, nombres, estado):
	doc = frappe.get_doc("POS Profile", perfil)
	presentes = {fila.mode_of_payment for fila in doc.payments}
	nuevas = [n for n in nombres if n not in presentes]
	for nombre in nuevas:
		doc.append("payments", {"mode_of_payment": nombre})
	# Modo sin conexion: catalogo y clientes en la terminal, ventas en cola que se envian al volver la red.
	cambio_offline = not doc.get("posa_allow_offline_mode")
	if cambio_offline:
		doc.posa_allow_offline_mode = 1
	cambio_estado = bool(estado) and not doc.get("ve_estado")
	if cambio_estado:
		doc.ve_estado = estado
	if not (nuevas or cambio_estado or cambio_offline):
		return False
	if doc.payments and not any(fila.default for fila in doc.payments):
		doc.payments[0].default = 1
	doc.save()
	return True


# Roles con los que se probo la caja (venta, devolucion, cierre). Se pueden cambiar con ``roles``.
ROLES_CAJERO = ["Sales User", "Accounts User", "Stock User", "Sales Manager"]


def crear_cajeros(cajeros, perfiles, roles=None):
	"""Crea (o actualiza) usuarios cajeros y los asigna a los POS Profile indicados.

	``cajeros``: lista de ``{"email": ..., "nombre": ...}``. No se guarda ni se muestra ninguna clave:
	por cada usuario NUEVO se devuelve un enlace de un solo uso para que el cajero fije la suya.

	Uso, en el servidor::

	    bench --site SITIO execute posawesome.ve_setup.crear_cajeros \
	        --kwargs "{'cajeros': [{'email': 'ana@tienda.com', 'nombre': 'Ana Perez'}], 'perfiles': ['Caja 1']}"
	"""
	roles = roles or ROLES_CAJERO
	resumen = {"creados": {}, "existentes": [], "perfiles": []}

	for cajero in cajeros:
		email = cajero["email"].strip().lower()
		if frappe.db.exists("User", email):
			user = frappe.get_doc("User", email)
			resumen["existentes"].append(email)
		else:
			nombre = (cajero.get("nombre") or email.split("@")[0]).strip()
			primero, _sep, resto = nombre.partition(" ")
			user = frappe.get_doc(
				{
					"doctype": "User",
					"email": email,
					"first_name": primero,
					"last_name": resto,
					"enabled": 1,
					"user_type": "System User",
					"send_welcome_email": 0,
				}
			)
			user.insert(ignore_permissions=True)
			resumen["creados"][email] = user._reset_password(send_email=False).replace("http://", "https://")
		presentes = {fila.role for fila in user.roles}
		faltan = [r for r in roles if r not in presentes]
		for rol in faltan:
			user.append("roles", {"role": rol})
		if faltan:
			user.save(ignore_permissions=True)

		for perfil in perfiles:
			doc = frappe.get_doc("POS Profile", perfil)
			if not any(fila.user == email for fila in doc.applicable_for_users):
				doc.append("applicable_for_users", {"user": email})
				doc.save()
				resumen["perfiles"].append(f"{email} -> {perfil}")

	frappe.db.commit()
	return resumen
