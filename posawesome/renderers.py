"""Sirve el service worker del POS en /posawesome-sw.js.

Los service workers solo controlan URLs bajo la carpeta desde la que se sirven. El archivo
compilado vive en /assets/posawesome/posawesome/, que no cubre /posawesome; por eso se sirve
desde la raiz y la app lo registra con alcance "/posawesome". Con eso la pantalla del POS y
sus archivos quedan guardados en la tablet y abren sin internet.
"""

from pathlib import Path

import frappe
from frappe.website.page_renderers.base_renderer import BaseRenderer
from werkzeug.wrappers import Response

SW_PATH = "posawesome-sw.js"


class ServiceWorkerPage(BaseRenderer):
	def can_render(self):
		return self.path == SW_PATH

	def render(self):
		archivo = Path(frappe.get_app_path("posawesome", "public", "posawesome", "sw.js"))
		if not archivo.is_file():
			return Response("", status=404)
		return Response(
			archivo.read_bytes(),
			mimetype="application/javascript",
			headers={"Cache-Control": "no-cache", "Service-Worker-Allowed": "/posawesome"},
		)
