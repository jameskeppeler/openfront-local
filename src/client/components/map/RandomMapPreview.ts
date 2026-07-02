import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  ProceduralMap,
  RANDOM_MAP_HEIGHT,
  RANDOM_MAP_WIDTH,
} from "../../../core/game/ProceduralMapGenerator";
import { translateText } from "../../Utils";

// Preview resolution (the 16x LOD dimensions). Small enough that regenerating
// on every click is instant.
const PREVIEW_W = RANDOM_MAP_WIDTH >> 2;
const PREVIEW_H = RANDOM_MAP_HEIGHT >> 2;

const IS_LAND = 0x80;
const SHORELINE = 0x40;
const MAGNITUDE_MASK = 0x1f;

// Mirror the map-generator's thumbnail palette (getThumbnailColor in
// map-generator/map_generator.go) so the generated preview — and the
// thumbnail we save from it — look identical to the stock map thumbnails in
// the picker. Water is transparent (alpha 0) so the dark panel shows through,
// exactly like the baked thumbnails.
function thumbnailColor(b: number): [number, number, number, number] {
  const isLand = (b & IS_LAND) !== 0;
  const shore = (b & SHORELINE) !== 0;
  const mag = b & MAGNITUDE_MASK;

  if (isLand && mag === 31) return [0, 0, 0, 0]; // impassable
  if (!isLand) {
    if (shore) return [100, 143, 255, 0]; // shoreline water
    const adj = 1 - Math.min(mag, 10); // deep water darkens with depth
    return [
      Math.max(70 + adj, 0),
      Math.max(132 + adj, 0),
      Math.max(180 + adj, 0),
      0,
    ];
  }
  if (shore) return [204, 203, 158, 255]; // sandy coast
  if (mag < 10) return [190, 220 - 2 * mag, 138, 255]; // plains
  if (mag < 20) {
    const adj = 2 * mag; // highland
    return [
      Math.min(255, 200 + adj),
      Math.min(255, 183 + adj),
      Math.min(255, 138 + adj),
      255,
    ];
  }
  const v = Math.min(255, 230 + Math.floor(mag / 2)); // mountain
  return [v, v, v, 255];
}

// Base64-encode a byte array in chunks (avoids call-stack limits of a single
// String.fromCharCode(...bigArray)).
function toBase64(u8: Uint8Array): string {
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < u8.length; i += CHUNK) {
    s += String.fromCharCode(...u8.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

// Renders a live preview of the procedurally-generated map for a given seed,
// with controls to regenerate (new seed) or go "fully random" (hide the map
// so no one sees it before the match). A null seed means "fully random".
@customElement("random-map-preview")
export class RandomMapPreview extends LitElement {
  @property({ type: Number }) seed: number | null = null;
  @state() private saving = false;

  createRenderRoot() {
    return this;
  }

  updated(changed: Map<string, unknown>) {
    if (changed.has("seed")) this.paint();
  }

  private paint() {
    if (this.seed === null) return;
    const canvas = this.querySelector<HTMLCanvasElement>("canvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const terrain = new ProceduralMap(this.seed).terrainBin("16x");
    const img = ctx.createImageData(PREVIEW_W, PREVIEW_H);
    for (let i = 0; i < terrain.length; i++) {
      const [r, g, b, a] = thumbnailColor(terrain[i]);
      const o = i * 4;
      img.data[o] = r;
      img.data[o + 1] = g;
      img.data[o + 2] = b;
      img.data[o + 3] = a;
    }
    // Clear first so transparent water reveals the dark panel behind the
    // canvas, matching how the stock thumbnails render their (transparent) seas.
    ctx.clearRect(0, 0, PREVIEW_W, PREVIEW_H);
    ctx.putImageData(img, 0, 0);
  }

  private emitSeed(seed: number | null) {
    this.dispatchEvent(
      new CustomEvent("random-seed-changed", {
        detail: { seed },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private handleRegenerate = () => {
    // A fresh 31-bit seed. Only needs to be agreed once (then broadcast) — not
    // part of the deterministic sim — so Math.random is fine here.
    this.emitSeed(Math.floor(Math.random() * 0x7fffffff));
  };

  private handleSurprise = () => this.emitSeed(null);

  private handleReveal = () =>
    this.emitSeed(Math.floor(Math.random() * 0x7fffffff));

  // Export the current map to disk as a real custom map (dev-only endpoint;
  // see /__save-map in vite.config.ts). Persists all three LOD .bin files, the
  // manifest, and a thumbnail, then reloads so the new map appears in Custom.
  private handleSave = async () => {
    if (this.seed === null || this.saving) return;
    const input = this.querySelector<HTMLInputElement>("#random-map-name");
    const name = input?.value.trim() ?? "";
    if (!name) {
      input?.focus();
      return;
    }
    this.saving = true;
    try {
      const map = new ProceduralMap(this.seed);
      const manifest = map.manifest();
      manifest.name = name;
      const payload = {
        name,
        manifest,
        map: toBase64(map.terrainBin("full")),
        map4x: toBase64(map.terrainBin("4x")),
        map16x: toBase64(map.terrainBin("16x")),
        thumbnail: await this.thumbnailBase64(),
      };
      const res = await fetch("/__save-map", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "save failed");
      alert(`Saved "${name}" to your Custom maps. Reloading…`);
      location.reload();
    } catch (e) {
      alert(`Save failed: ${(e as Error).message}`);
      this.saving = false;
    }
  };

  private thumbnailBase64(): Promise<string | undefined> {
    const canvas = this.querySelector<HTMLCanvasElement>("canvas");
    if (!canvas) return Promise.resolve(undefined);
    return new Promise((resolve) => {
      canvas.toBlob(
        (blob) => {
          if (!blob) return resolve(undefined);
          blob
            .arrayBuffer()
            .then((ab) => resolve(toBase64(new Uint8Array(ab))));
        },
        "image/webp",
        0.85,
      );
    });
  }

  render() {
    const fullyRandom = this.seed === null;
    return html`<div
      class="w-full mt-4 rounded-xl border border-white/10 bg-black/20 p-4 space-y-3"
    >
      <div class="flex items-center justify-between">
        <span class="text-xs font-bold text-white/60 uppercase tracking-widest">
          ${translateText("map_component.random_preview")}
        </span>
        ${!fullyRandom
          ? html`<span class="text-[10px] text-white/30 font-mono"
              >#${this.seed}</span
            >`
          : null}
      </div>
      ${fullyRandom
        ? html`<div
            class="mx-auto h-40 aspect-[3/2] max-w-full rounded-lg bg-black/40 border border-dashed border-white/15 flex flex-col items-center justify-center gap-2 text-white/40"
          >
            <span class="text-4xl font-black">?</span>
            <span class="text-xs uppercase tracking-wider text-center px-4"
              >${translateText("map_component.random_hidden")}</span
            >
          </div>`
        : html`<canvas
            width=${PREVIEW_W}
            height=${PREVIEW_H}
            class="mx-auto h-40 aspect-[3/2] max-w-full rounded-lg bg-black/40 [image-rendering:auto]"
          ></canvas>`}
      <div class="flex gap-2">
        ${fullyRandom
          ? html`<button
              type="button"
              @click=${this.handleReveal}
              class="flex-1 px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wider bg-malibu-blue/20 text-white border border-malibu-blue/40 hover:bg-malibu-blue/30 transition-all active:scale-95"
            >
              ${translateText("map_component.random_pick")}
            </button>`
          : html`<button
                type="button"
                @click=${this.handleRegenerate}
                class="flex-1 px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wider bg-malibu-blue/20 text-white border border-malibu-blue/40 hover:bg-malibu-blue/30 transition-all active:scale-95"
              >
                ${translateText("map_component.random_regenerate")}
              </button>
              <button
                type="button"
                @click=${this.handleSurprise}
                class="flex-1 px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wider bg-white/5 text-white/70 border border-white/10 hover:bg-white/10 transition-all active:scale-95"
              >
                ${translateText("map_component.random_surprise")}
              </button>`}
      </div>
      ${fullyRandom
        ? null
        : html`<div class="flex gap-2 pt-1">
            <input
              id="random-map-name"
              type="text"
              maxlength="32"
              placeholder=${translateText("map_component.random_save_name")}
              class="flex-1 min-w-0 px-3 py-2 rounded-lg text-xs bg-black/30 text-white border border-white/10 focus:border-malibu-blue/50 outline-none placeholder:text-white/30"
            />
            <button
              type="button"
              @click=${this.handleSave}
              ?disabled=${this.saving}
              class="px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wider bg-emerald-500/20 text-white border border-emerald-400/40 hover:bg-emerald-500/30 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              ${this.saving
                ? translateText("map_component.random_saving")
                : translateText("map_component.random_save")}
            </button>
          </div>`}
    </div>`;
  }
}
