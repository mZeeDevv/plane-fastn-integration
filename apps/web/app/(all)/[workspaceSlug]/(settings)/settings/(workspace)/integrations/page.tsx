/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useMemo, useState } from "react";
import { observer } from "mobx-react";
import useSWR from "swr";
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

function WorkspaceIntegrationsPage() {
  const { t } = useTranslation();
  const { currentWorkspace } = useWorkspace();
  const [frameHeight, setFrameHeight] = useState<number | null>(null);
  const slug = currentWorkspace?.slug;
  const pageTitle = currentWorkspace?.name ? `${currentWorkspace.name} - Plane Integration` : undefined;

  // The embed token lives 8h and refreshes itself inside the frame; never refetch on focus.
  const { data, error } = useSWR(slug ? `FASTN_EMBED_${slug}` : null, () => fastnService.getEmbedUrl(slug!), {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });

  // The hub reports its content height (auto-height), so the frame never shows its own blank page.
  const frameOrigin = data?.iframe_url ? new URL(data.iframe_url).origin : null;
  useEffect(() => {
    if (!frameOrigin) return;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== frameOrigin || event.data?.type !== "fastn:resize") return;
      const height = Number(event.data.payload?.height);
      if (Number.isFinite(height) && height > 0) setFrameHeight(Math.ceil(height));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [frameOrigin]);

  // Styling, sections and header come from the fastn hub settings; the frame only picks the layout.
  const iframeSrc = useMemo(() => {
    if (!data?.iframe_url) return null;
    const url = new URL(data.iframe_url);
    url.searchParams.set("config", FASTN_THEME_CONFIG_ID); // "Plane Dark" iframe config in fastn; the default hub theme is untouched
    url.searchParams.set("theme", JSON.stringify(PLANE_DARK_THEME));
    url.searchParams.set("view", "hub");
    url.searchParams.set("auto-height", "1");
    return url.toString();
  }, [data?.iframe_url]);

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
              title="Integrations"
              src={iframeSrc}
              className="w-full border-0"
              style={{ height: frameHeight ? `${frameHeight}px` : "calc(100vh - 200px)" }}
              allow="clipboard-write"
            />
          ) : (
            <p className="text-body-sm-regular text-tertiary">Loading integrations...</p>
          )}
        </div>
      </section>
    </>
  );
}

export default observer(WorkspaceIntegrationsPage);
