# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import logging
import os
from urllib.parse import quote

import requests
from django.core.cache import cache
from rest_framework import status
from rest_framework.response import Response

from plane.app.permissions import ROLE, allow_permission
from plane.db.models import APIToken, Workspace

from ..base import BaseAPIView

logger = logging.getLogger("plane.api")

FASTN_TOKEN_LABEL = "fastn-integration"
PROVISIONED_TTL = 12 * 60 * 60


def _fastn_error(resp):
    try:
        body = resp.json()
        return body.get("error") or (body.get("data") or {}).get("error") or body.get("message")
    except (ValueError, AttributeError):
        return None


def _provision_plane_connection(api_url, api_key, workspace, user):
    """Give the workspace's fastn customer a Plane connection, so workflows can act on Plane.

    The Plane app is the partner's own product in the fastn integration: the partner connects it
    per customer, never the end user. Upserted by name, cached so it is not resent on every load.
    """
    connector_id = os.environ.get("FASTN_PLANE_CONNECTOR_ID")
    auth_method_id = os.environ.get("FASTN_PLANE_AUTH_METHOD_ID")
    public_api_url = os.environ.get("PLANE_PUBLIC_API_URL", "").rstrip("/")
    if not (connector_id and auth_method_id and public_api_url):
        return

    cache_key = f"fastn:plane-connection:{workspace.id}:{public_api_url}"
    if cache.get(cache_key):
        return

    token = APIToken.objects.filter(workspace=workspace, label=FASTN_TOKEN_LABEL, is_active=True).first()
    if token is None:
        token = APIToken.objects.create(
            workspace=workspace,
            user=user,
            label=FASTN_TOKEN_LABEL,
            description="Used by fastn integrations to read and write this workspace.",
        )

    headers = {"X-API-Key": api_key, "Content-Type": "application/json"}
    credentials = {"apiToken": token.token, "workspaceSlug": workspace.slug, "baseUrl": public_api_url}
    resp = requests.post(
        f"{api_url}/api/v1/connections",
        headers=headers,
        json={
            "connectorId": connector_id,
            "authMethodId": auth_method_id,
            "endOrgId": str(workspace.id),
            "name": "default",
            "credentials": credentials,
        },
        timeout=30,
    )
    if resp.status_code == 409:
        # The customer already has its Plane connection (saved with an older public URL or token):
        # create does not overwrite it, so update its credentials in place.
        existing = requests.get(
            f"{api_url}/api/v1/connections",
            headers=headers,
            params={"connectorId": connector_id, "endOrgId": str(workspace.id)},
            timeout=15,
        )
        rows = (existing.json().get("data") if existing.ok else None) or []
        connection = next((r for r in rows if isinstance(r, dict) and r.get("name") == "default"), None)
        if connection:
            resp = requests.put(
                f"{api_url}/api/v1/connections/{quote(connection['id'], safe='')}",
                headers=headers,
                json={"credentials": credentials},
                timeout=30,
            )
    if resp.status_code >= 400:
        logger.warning(
            "fastn Plane connection not saved",
            extra={"workspace": workspace.slug, "status": resp.status_code, "error": _fastn_error(resp)},
        )
        return
    cache.set(cache_key, True, PROVISIONED_TTL)


class FastnEmbedTokenEndpoint(BaseAPIView):
    """Mints a fastn embed session for the workspace.

    The fastn API key stays on the server; the browser only ever gets a short-lived
    emb_ token scoped to this workspace as a fastn customer.
    """

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def post(self, request, slug):
        api_url = os.environ.get("FASTN_API_URL", "").rstrip("/")
        api_key = os.environ.get("FASTN_API_KEY", "")
        if not api_url or not api_key:
            return Response(
                {"error": "fastn is not configured: set FASTN_API_URL and FASTN_API_KEY"},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        workspace = Workspace.objects.get(slug=slug)
        try:
            upstream = requests.post(
                f"{api_url}/api/v1/embed/token",
                headers={"X-API-Key": api_key, "Content-Type": "application/json"},
                json={
                    "endOrgId": str(workspace.id),
                    "customerName": workspace.name,
                    "createIfMissing": True,
                    "userId": str(request.user.id),
                },
                timeout=15,
            )
        except requests.RequestException:
            return Response({"error": "fastn is unreachable"}, status=status.HTTP_502_BAD_GATEWAY)

        if upstream.status_code >= 400:
            return Response(
                {"error": _fastn_error(upstream) or f"fastn refused the token request ({upstream.status_code})"},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        payload = upstream.json()
        token = (payload.get("data") or payload).get("token")
        if not token:
            return Response({"error": "fastn returned no embed token"}, status=status.HTTP_502_BAD_GATEWAY)

        # After the mint, which creates the customer on first use. A failure here leaves the hub
        # usable; the integration simply waits for the connection, as it did before.
        try:
            _provision_plane_connection(api_url, api_key, workspace, request.user)
        except requests.RequestException:
            logger.warning("fastn unreachable while saving the Plane connection", extra={"workspace": slug})

        params = {"token": token, "parent-origin": request.headers.get("Origin", "")}
        widget_id = os.environ.get("FASTN_WIDGET_ID")
        if widget_id:
            params["widget-id"] = widget_id
        iframe_url = requests.Request("GET", f"{api_url}/api/v1/embed/iframe", params=params).prepare().url
        return Response({"iframe_url": iframe_url}, status=status.HTTP_200_OK)
