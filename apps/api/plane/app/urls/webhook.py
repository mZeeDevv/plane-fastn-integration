# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.urls import path

from plane.app.views import (
    WebhookEndpoint,
    WebhookLogsEndpoint,
    WebhookSecretRegenerateEndpoint,
    FastnEmbedTokenEndpoint,
)


urlpatterns = [
    path(
        "workspaces/<str:slug>/fastn/embed-token/",
        FastnEmbedTokenEndpoint.as_view(),
        name="fastn-embed-token",
    ),
    path("workspaces/<str:slug>/webhooks/", WebhookEndpoint.as_view(), name="webhooks"),
    path(
        "workspaces/<str:slug>/webhooks/<uuid:pk>/",
        WebhookEndpoint.as_view(),
        name="webhooks",
    ),
    path(
        "workspaces/<str:slug>/webhooks/<uuid:pk>/regenerate/",
        WebhookSecretRegenerateEndpoint.as_view(),
        name="webhooks",
    ),
    path(
        "workspaces/<str:slug>/webhook-logs/<uuid:webhook_id>/",
        WebhookLogsEndpoint.as_view(),
        name="webhooks",
    ),
]
