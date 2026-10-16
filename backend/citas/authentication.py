
import hashlib

from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.permissions import BasePermission
from rest_framework.authentication import get_authorization_header

from citas.models import EquipoActivado


class EquipoTokenAuthentication(BaseAuthentication):
    def authenticate(self, request):
        partes = get_authorization_header(request).split()

        if not partes:
            return None

        if len(partes) != 2 or partes[0].lower() != b"bearer":
            raise AuthenticationFailed(
                "Formato de autenticación inválido."
            )

        try:
            token = partes[1].decode("utf-8")
        except UnicodeDecodeError as exc:
            raise AuthenticationFailed(
                "Token inválido."
            ) from exc

        token_hash = hashlib.sha256(
            token.encode("utf-8")
        ).hexdigest()

        equipo = (
            EquipoActivado.objects
            .select_related("establecimiento", "consultorio")
            .filter(token_hash=token_hash, activo=True)
            .first()
        )

        if equipo is None:
            raise AuthenticationFailed(
                "Credencial inválida o equipo desactivado."
            )

        return equipo, token

    def authenticate_header(self, request):
        return "Bearer"


class EsEquipoActivado(BasePermission):
    def has_permission(self, request, view):
        return (
            isinstance(request.user, EquipoActivado)
            and request.user.activo
        )
