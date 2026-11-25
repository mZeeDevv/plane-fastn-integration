/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { observer } from "mobx-react";
import useSWR from "swr";
import { Dialog, DialogClose, DialogCloseGroup, DialogContent } from "@makeplane/propel/components/dialog";
import { Icon } from "@makeplane/propel/components/icon";
import { IconButton } from "@makeplane/propel/components/icon-button";
import { CloseOutline } from "@makeplane/propel/icons";
import { useTranslation } from "@plane/i18n";
import { PageHead } from "@/components/core/page-title";
import { useWorkspace } from "@/hooks/store/use-workspace";
import { FastnService } from "@/services/fastn.service";

const fastnService = new FastnService();
// fastn iframe config "Plane Dark": Plane's dark surfaces with Plane purple buttons.
const FASTN_THEME_CONFIG_ID = "eic_3cc45aa32120";
// The same "Plane Dark" tokens, sent on the frame URL too: the hub applies a host-supplied theme directly,
// so the page stays dark even when the saved config is not resolved. The default hub theme is untouched.
const PLANE_DARK_THEME = {
  background: "#141415",
  foreground: "#e5e6e6",
  card: "#1e1f20",
  muted: "#2c2c2d",
  mutedForeground: "#a1a1a3",
  border: "#2c2c2d",
  primary: "#943d73",
  primaryForeground: "#ffffff",
  fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  fontSize: 14,
  fontWeight: 400,
  letterSpacing: "normal",
  radius: 8,
  buttonRadius: 6,
  inputRadius: 6,
  shadowStrength: "none",
};

// What a card asks the host to open. "standard" is the compare menu's plain-connect choice.
type TFastnOpen = { view: string; widgetId?: string };

function frameUrl(base: string, view: string, widgetId?: string): string {
  const url = new URL(base);
  url.searchParams.set("config", FASTN_THEME_CONFIG_ID); // "Plane Dark" iframe config in fastn; the default hub theme is untouched
  url.searchParams.set("theme", JSON.stringify(PLANE_DARK_THEME));
  url.searchParams.set("view", view);
  if (widgetId) url.searchParams.set("widget-id", widgetId);
  url.searchParams.set("auto-height", "1");
  return url.toString();
}

function WorkspaceIntegrationsPage() {
  const { t } = useTranslation();
  const { currentWorkspace } = useWorkspace();
  const cardsFrame = useRef<HTMLIFrameElement>(null);
  const dialogFrame = useRef<HTMLIFrameElement>(null);
  const [frameHeight, setFrameHeight] = useState<number | null>(null);
  const [dialogHeight, setDialogHeight] = useState<number | null>(null);
  const [opened, setOpened] = useState<TFastnOpen | null>(null);
  const slug = currentWorkspace?.slug;
  const pageTitle = currentWorkspace?.name ? `${currentWorkspace.name} - Plane Integration` : undefined;

  // The embed token lives 8h and refreshes itself inside the frame; never refetch on focus.
  const { data, error } = useSWR(slug ? `FASTN_EMBED_${slug}` : null, () => fastnService.getEmbedUrl(slug!), {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });

  const frameOrigin = data?.iframe_url ? new URL(data.iframe_url).origin : null;

  const closeDialog = () => {
    setOpened(null);
    setDialogHeight(null);
    // A connect or disconnect in the dialog changes what the cards show.
    if (frameOrigin) cardsFrame.current?.contentWindow?.postMessage({ type: "fastn:refresh" }, frameOrigin);
  };

  // Both frames report their content height (auto-height). The cards frame asks the host to open
  // an app's connect step or page (fastn:open); the dialog frame asks to be dismissed (fastn:close).
  useEffect(() => {
    if (!frameOrigin) return;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== frameOrigin) return;
      const { type, payload } = (event.data ?? {}) as { type?: string; payload?: Record<string, unknown> };
      const fromCards = event.source === cardsFrame.current?.contentWindow;
      const fromDialog = event.source === dialogFrame.current?.contentWindow;
      if (type === "fastn:resize") {
        const height = Math.ceil(Number(payload?.height));
        if (!Number.isFinite(height) || height <= 0) return;
        if (fromCards) setFrameHeight(height);
        if (fromDialog) setDialogHeight(height);
      } else if (type === "fastn:open" && fromCards && typeof payload?.view === "string") {
        const view = payload.view === "standard" ? "connect" : payload.view;
        setDialogHeight(null);
        setOpened({ view, widgetId: typeof payload.widgetId === "string" ? payload.widgetId : undefined });
      } else if (type === "fastn:close" && fromDialog) {
        closeDialog();
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
    // closeDialog only reads refs and frameOrigin.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameOrigin]);

  // "cards" lists every integration (connected or not); fastn's "hub" view always opens filtered to connected apps.
  const iframeSrc = useMemo(() => (data?.iframe_url ? frameUrl(data.iframe_url, "cards") : null), [data?.iframe_url]);
  const dialogSrc = useMemo(
    () => (data?.iframe_url && opened ? frameUrl(data.iframe_url, opened.view, opened.widgetId) : null),
    [data?.iframe_url, opened]
  );

  return (
    <>
      <PageHead title={pageTitle} />
      <section className="flex h-full w-full flex-col">
        <div className="flex flex-col gap-1 border-b border-subtle py-3.5">
          <h3 className="text-h5-medium">Plane Integration</h3>
          <p className="text-body-sm-regular text-tertiary">
            {t("workspace_settings.settings.integrations.description")}
          </p>
        </div>
        <div className="flex-1 py-4">
          {error ? (
            <p className="text-body-sm-regular text-danger-primary">
              {(error as { error?: string })?.error ?? "Could not load integrations."}
            </p>
          ) : iframeSrc ? (
            <iframe
              ref={cardsFrame}
              title="Integrations"
              src={iframeSrc}
              className="w-full border-0"
              style={{
                height: frameHeight ? `${frameHeight}px` : "calc(100vh - 200px)",
                background: PLANE_DARK_THEME.background, // no white flash while the hub loads
                colorScheme: "dark",
              }}
              allow="clipboard-write"
            />
          ) : (
            <p className="text-body-sm-regular text-tertiary">Loading integrations...</p>
          )}
        </div>
      </section>
      <Dialog
        open={!!dialogSrc}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
      >
        <DialogContent size="lg">
          <DialogCloseGroup>
            <IconButton
              variant="ghost"
              size="xs"
              aria-label={t("close")}
              icon={<Icon icon={CloseOutline} />}
              render={<DialogClose />}
            />
          </DialogCloseGroup>
          {dialogSrc ? (
            <iframe
              ref={dialogFrame}
              title="Connect integration"
              src={dialogSrc}
              className="w-full border-0"
              style={{
                height: `${Math.min(dialogHeight ?? 560, 720)}px`,
                background: PLANE_DARK_THEME.background,
                colorScheme: "dark",
              }}
              allow="clipboard-write"
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

export default observer(WorkspaceIntegrationsPage);
