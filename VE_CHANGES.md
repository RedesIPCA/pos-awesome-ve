# Localización Venezuela — cambios sobre CyteERP POS Awesome v16

Este repositorio es un fork de [phillipnc/cyteerp-pos-awesome](https://github.com/phillipnc/cyteerp-pos-awesome)
(remoto `upstream`) con los cambios de Redes IP para operar el POS en Venezuela sobre ERPNext 16.
La licencia es la del proyecto original (GPL-3.0).

## Qué agrega

| Cambio | Dónde |
|---|---|
| Alta de cliente con RIF, tipo, categoría, dirección, ciudad y estado (prellenado con el estado de la caja). Etiquetas en español. Crea la `Address` con el endpoint `make_address` existente. | `frontend/src/components/customer/CustomerFormModal.vue`, `lib/api.ts`, `types/index.ts` |
| Cobro en varias monedas: cada forma de pago tiene su moneda (`Mode of Payment.ve_moneda`); lo recibido en divisa se digita en esa moneda y se convierte a la tasa del día. Equivalentes en USD/EUR en carrito, cobro, saldo y vuelto. Botón **Exacto** por divisa. | `frontend/src/stores/payments.ts`, `components/payment/PaymentPanel.vue`, `components/cart/CartTotals.vue` |
| La contabilidad va siempre en moneda local. La divisa recibida queda en cada fila de pago (`ve_moneda`, `ve_monto_divisa`, `ve_tasa`) y en las observaciones de la factura. | `stores/payments.ts` + campos de `install.py` |
| **IGTF** solo sobre la parte del precio pagada en divisa, sumado al precio como un impuesto más. El POS usa la misma regla que el servidor. | `stores/payments.ts`; el servidor lo aplica `erpnext_ve` (ver abajo) |
| Arqueo de caja por moneda: el cierre espera, cuenta y compara los dólares en dólares. | `views/CloseShiftView.vue`, `posawesome/api/shift.py` |
| El vuelto ya no se envía como anticipo del cliente (`credit_change`), que lo duplicaba. En una devolución el monto por forma de pago se limita a lo adeudado. | `stores/payments.ts` |
| Campos `ve_*` creados al instalar y al migrar, y `setup_pos_ve(empresa)` para dejar una empresa lista. | `posawesome/install.py`, `posawesome/ve_setup.py` |
| Interfaz en español (todo el texto visible; fechas es-VE). | `frontend/src/**` |
| **Sin conexión**: la pantalla del POS se guarda en la terminal (service worker servido en `/posawesome-sw.js`), el catálogo y los clientes quedan en IndexedDB, y las ventas se encolan y se envían solas al volver la red. El servidor reenvía la factura completa (pagos y divisas) y aplica el IGTF. | `vite.config.ts`, `src/main.ts`, `src/lib/db.ts`, `posawesome/renderers.py`, `posawesome/api/offline.py` |
| `crear_cajeros(cajeros, perfiles)`: usuarios cajeros con enlace de un solo uso para fijar su clave. | `posawesome/ve_setup.py` |

## Instalar en un cliente nuevo

```bash
bench get-app <URL_DE_ESTE_REPO>          # rama main; el frontend ya viene compilado
bench --site SITIO install-app posawesome  # crea los campos ve_*
bench --site SITIO migrate
bench --site SITIO execute posawesome.ve_setup.setup_pos_ve \
    --kwargs "{'company': 'Mi Empresa C.A.', 'estado': 'Miranda'}"
```

`setup_pos_ve` es idempotente: crea las cuentas (en moneda de la empresa), las formas de pago
(Efectivo USD/EUR, Punto de venta, Pago móvil, Zelle, Transferencia), habilita USD/EUR y las asigna
a los POS Profile de la empresa. Ver el docstring de `posawesome/ve_setup.py`.

Además cada cliente necesita:

- **Tasa USD→VES** en *Currency Exchange* (por ejemplo la del BCV). Este repo no la carga.
- **`erpnext_ve`** instalada: aplica el IGTF y expone `erpnext_ve.events.igtf.get_igtf_rate`, que el
  POS llama para conocer la tasa. Sin esa app la tasa queda en 0 y no se cobra IGTF. Requiere la
  versión de `erpnext_ve` donde `apply_igtf` corre en `before_validate` (ERPNext borra los pagos de
  una devolución con IGTF si se aplica después).
- Después de cambiar `hooks.py` de cualquier app: `bench clear-cache` (los hooks se cachean en Redis).

## Reconstruir el frontend

El bundle compilado (`posawesome/public/posawesome` y `posawesome/www/posawesome.html`) está
versionado a propósito, así que un servidor sin Node puede instalarlo. Para recompilar después de
tocar `frontend/src`:

```bash
docker run --rm -v "$PWD":/app -w /app/frontend node:24 sh -c "npm ci && npm run build:fast"
```

Hay que desplegar juntos el HTML y los assets: los nombres de archivo llevan hash.

## Actualizar desde el proyecto original

```bash
git fetch upstream
git merge upstream/main        # revisar conflictos en los archivos de la tabla; recompilar el frontend
```

## Límites conocidos

- La caja de dólares se lleva valorada en moneda local a la tasa del día; no hay saldo real en USD.
- Si el cliente entrega en divisa menos que el precio e incluye en esa misma entrega el IGTF, la base
  del impuesto se calcula sobre todo lo entregado (diferencia de centavos). Se evita con **Exacto**.
- El datáfono y la impresora fiscal no están integrados (ver la hoja de ruta de hardware del proyecto).

## Sin conexión: cómo funciona y qué no cubre

- Requiere la opción *posa_allow_offline_mode* en el POS Profile (`setup_pos_ve` la activa).
- La terminal debe abrir el POS **con red al menos una vez** (y tener el turno abierto): así guarda la pantalla, el catálogo, los clientes, la tasa de cambio y la tasa del IGTF.
- Sin red se puede vender a clientes ya guardados en la terminal, cobrar en cualquier moneda y el IGTF se calcula igual. La venta queda en cola y se envía al volver la red; el servidor la emite con los pagos y el IGTF.
- No funciona sin red: abrir o cerrar turno, crear clientes nuevos, poner una factura en espera, imprimir el comprobante desde el servidor, ni ver créditos/anticipos del cliente.
- Para probar: abrir el POS con red, activar el modo avión (o DevTools → Network → Offline), vender, y desactivarlo: la cola debe vaciarse sola.
