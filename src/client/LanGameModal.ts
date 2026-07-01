import { html, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { translateText } from "../client/Utils";
import "./components/baseComponents/Modal";
import { BaseModal, ModalConfig } from "./components/BaseModal";
import { modalHeader } from "./components/ui/ModalHeader";
import { HostLobbyModal } from "./HostLobbyModal";
import { fetchLanAddresses, isShareableLanOrigin } from "./Lan";

/**
 * The "LAN Game" landing screen. Explains the local-network flow, shows the
 * exact address friends should open, and routes the host to the existing
 * create/join lobby modals. Hosting and joining themselves reuse the normal
 * private-lobby machinery — on a LAN address those run fully offline as guests
 * (see Lan.ts / Auth.ts), so no new networking is needed here.
 */
@customElement("lan-game-modal")
export class LanGameModal extends BaseModal {
  @state() private addresses: string[] = [];
  @state() private copied = false;

  constructor() {
    super();
    this.id = "page-lan-game";
  }

  protected modalConfig(): ModalConfig {
    return { maxWidth: "640px" };
  }

  protected onOpen(): void {
    this.copied = false;
    void this.loadAddresses();
  }

  // Ask the server which private IPv4 addresses it's reachable on. Best-effort:
  // if the page is already on a LAN address we can fall back to the current
  // origin, so a failed fetch is not fatal.
  private async loadAddresses(): Promise<void> {
    this.addresses = await fetchLanAddresses();
  }

  // The full URLs friends should open. Prefer server-detected interfaces; if
  // none were reported but the page itself is already on a shareable LAN
  // address, fall back to the current origin.
  private shareUrls(): string[] {
    const port = window.location.port ? `:${window.location.port}` : "";
    const urls = this.addresses.map((ip) => `http://${ip}${port}`);
    if (urls.length === 0 && isShareableLanOrigin()) {
      urls.push(window.location.origin);
    }
    return urls;
  }

  private async copy(url: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      this.copied = true;
      setTimeout(() => (this.copied = false), 1500);
    } catch (e) {
      console.error("Failed to copy LAN url", e);
    }
  }

  private openHost = () => {
    this.close();
    (document.querySelector("host-lobby-modal") as HostLobbyModal)?.open();
  };

  private openJoin = () => {
    this.close();
    (
      document.querySelector("join-lobby-modal") as HTMLElement & {
        open: () => void;
      }
    )?.open();
  };

  protected renderHeaderSlot() {
    return modalHeader({
      title: translateText("lan.title"),
      onBack: () => this.close(),
      ariaLabel: translateText("common.back"),
    });
  }

  protected renderBody(): TemplateResult {
    const urls = this.shareUrls();
    const onLocalhost = !isShareableLanOrigin();

    return html`
      <div class="flex flex-col gap-5 p-4 lg:p-6 text-white">
        <p class="text-sm text-white/70">${translateText("lan.intro")}</p>

        <!-- Address to share -->
        <div class="rounded-lg bg-black/30 border border-white/10 p-4">
          <div class="text-xs uppercase tracking-widest text-white/50 mb-2">
            ${translateText("lan.share_label")}
          </div>
          ${onLocalhost && urls.length === 0
            ? html`<p class="text-yellow-400 text-sm">
                ${translateText("lan.localhost_warning")}
              </p>`
            : urls.length === 0
              ? html`<p class="text-white/50 text-sm">
                  ${translateText("lan.no_address")}
                </p>`
              : html`
                  ${onLocalhost
                    ? html`<p class="text-yellow-400 text-xs mb-2">
                        ${translateText("lan.localhost_warning")}
                      </p>`
                    : ""}
                  <div class="flex flex-col gap-2">
                    ${urls.map(
                      (url) => html`
                        <div class="flex items-center gap-2">
                          <code
                            class="flex-1 select-all rounded bg-black/40 px-3 py-2 text-malibu-blue font-mono text-sm break-all"
                            >${url}</code
                          >
                          <button
                            @click=${() => this.copy(url)}
                            class="shrink-0 rounded bg-malibu-blue hover:bg-aquarius px-3 py-2 text-sm font-medium uppercase tracking-wider transition-colors"
                          >
                            ${this.copied
                              ? translateText("lan.copied")
                              : translateText("lan.copy")}
                          </button>
                        </div>
                      `,
                    )}
                  </div>
                `}
          <p class="text-xs text-white/40 mt-3">
            ${translateText("lan.same_network")}
          </p>
        </div>

        <!-- Host / Join actions -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            @click=${this.openHost}
            class="flex flex-col items-start gap-1 rounded-lg bg-malibu-blue hover:bg-aquarius transition-colors p-4 text-left"
          >
            <span class="font-bold uppercase tracking-wider"
              >${translateText("lan.host")}</span
            >
            <span class="text-xs text-white/80"
              >${translateText("lan.host_desc")}</span
            >
          </button>
          <button
            @click=${this.openJoin}
            class="flex flex-col items-start gap-1 rounded-lg bg-surface hover:brightness-110 transition-all p-4 text-left"
          >
            <span class="font-bold uppercase tracking-wider"
              >${translateText("lan.join")}</span
            >
            <span class="text-xs text-white/80"
              >${translateText("lan.join_desc")}</span
            >
          </button>
        </div>
      </div>
    `;
  }
}
