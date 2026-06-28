import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { assetUrl } from "../../../core/AssetUrls";
import {
  Difficulty,
  GameMapType,
  MapCategory,
  mapCategoryOrder,
  MapInfo,
  maps,
} from "../../../core/game/Game";
import { translateText } from "../../Utils";
import "./MapDisplay";
import { getFavoriteMaps, starIcon, toggleFavoriteMap } from "./MapFavorites";
const randomMap = assetUrl("images/RandomMap.webp");

type MapTab = "featured" | "all" | "custom" | "favorites";

// Featured grid order: ranked maps first (1 = first), unranked alphabetical.
const featuredMaps: MapInfo[] = maps
  .filter((m) => m.categories.includes("featured"))
  .sort(
    (a, b) =>
      (a.featuredRank ?? Number.MAX_SAFE_INTEGER) -
      (b.featuredRank ?? Number.MAX_SAFE_INTEGER),
  );

function mapsInCategory(category: MapCategory): MapInfo[] {
  return maps.filter((m) => m.categories.includes(category));
}

// --- Soft-delete for custom maps ------------------------------------------
// Deleting a custom map hides it instantly (no jarring full-page reload) by
// recording its id here; the real files/registration are removed on the next
// app close/restart (see the pagehide handler below). Stale ids (maps already
// removed) are pruned on read.
const HIDDEN_CUSTOM_MAPS_KEY = "hiddenCustomMaps";

function customMapIds(): Set<string> {
  return new Set(
    maps.filter((m) => m.categories.includes("custom")).map((m) => m.id),
  );
}

function readHiddenCustomMaps(): string[] {
  try {
    const raw = localStorage.getItem(HIDDEN_CUSTOM_MAPS_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function getHiddenCustomMaps(): Set<string> {
  const stored = readHiddenCustomMaps();
  const valid = customMapIds();
  const pruned = stored.filter((id) => valid.has(id));
  if (pruned.length !== stored.length) {
    try {
      localStorage.setItem(HIDDEN_CUSTOM_MAPS_KEY, JSON.stringify(pruned));
    } catch {
      /* ignore */
    }
  }
  return new Set(pruned);
}

function hideCustomMap(id: string): Set<string> {
  const set = getHiddenCustomMaps();
  set.add(id);
  try {
    localStorage.setItem(HIDDEN_CUSTOM_MAPS_KEY, JSON.stringify([...set]));
  } catch {
    /* ignore */
  }
  return set;
}

// On app close/restart, actually delete the maps the user hid this session.
// sendBeacon survives unload; the resulting dev-server file change doesn't
// matter because the page is going away.
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    for (const id of readHiddenCustomMaps()) {
      try {
        navigator.sendBeacon?.(`/__delete-map?id=${encodeURIComponent(id)}`);
      } catch {
        /* ignore */
      }
    }
  });
}

@customElement("map-picker")
export class MapPicker extends LitElement {
  @property({ type: String }) selectedMap: GameMapType = GameMapType.World;
  @property({ type: Boolean }) useRandomMap = false;
  @property({ type: Boolean }) showMedals = false;
  @property({ type: Boolean }) randomMapDivider = false;
  @property({ type: String }) searchQuery = "";
  @property({ attribute: false }) mapWins: Map<GameMapType, Set<Difficulty>> =
    new Map();
  @property({ attribute: false }) onSelectMap?: (map: GameMapType) => void;
  @property({ attribute: false }) onSelectRandom?: () => void;
  @state() private activeTab: MapTab = "featured";
  @state() private expandedCategories: Set<string> = new Set();
  @state() private favorites: GameMapType[] = getFavoriteMaps();
  @state() private hiddenMaps: Set<string> = getHiddenCustomMaps();

  createRenderRoot() {
    return this;
  }

  private handleToggleFavorite(mapValue: GameMapType) {
    this.favorites = toggleFavoriteMap(mapValue);
  }

  private handleMapSelection(mapValue: GameMapType) {
    this.onSelectMap?.(mapValue);
  }

  private handleSelectRandomMap = () => {
    this.onSelectRandom?.();
  };

  private toggleCategory(categoryKey: string) {
    const expanded = new Set(this.expandedCategories);
    if (expanded.has(categoryKey)) {
      expanded.delete(categoryKey);
    } else {
      expanded.add(categoryKey);
    }
    this.expandedCategories = expanded;
  }

  private preventImageDrag(event: DragEvent) {
    event.preventDefault();
  }

  private get filteredMaps(): MapInfo[] {
    if (!this.searchQuery.trim()) return [];
    const query = this.searchQuery.trim().toLowerCase();
    return maps.filter((m) => {
      const name = translateText(m.translationKey).toLowerCase();
      const id = m.id.toLowerCase();
      return name.includes(query) || id.includes(query);
    });
  }

  private getWins(mapValue: GameMapType): Set<Difficulty> {
    return this.mapWins?.get(mapValue) ?? new Set();
  }

  private renderMapCard(map: MapInfo) {
    return html`
      <div
        @click=${() => this.handleMapSelection(map.type)}
        class="cursor-pointer"
      >
        <map-display
          .mapKey=${map.id}
          .selected=${!this.useRandomMap && this.selectedMap === map.type}
          .showMedals=${this.showMedals}
          .wins=${this.getWins(map.type)}
          .favorite=${this.favorites.includes(map.type)}
          .onToggleFavorite=${() => this.handleToggleFavorite(map.type)}
          .translation=${translateText(map.translationKey)}
        ></map-display>
      </div>
    `;
  }

  private renderMapGrid(mapList: MapInfo[]) {
    // Keyed by map so cards keep their identity when the list shifts
    // (e.g. the selected map gets prepended to the featured grid) —
    // positional reuse would leave stale thumbnails behind.
    return html`<div
      class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4"
    >
      ${repeat(
        mapList,
        (map) => map.id,
        (map) => this.renderMapCard(map),
      )}
    </div>`;
  }

  private renderSectionHeading(label: string) {
    return html`<h4
      class="text-xs font-bold text-white/40 uppercase tracking-widest mb-4 pl-2"
    >
      ${label}
    </h4>`;
  }

  private renderCategoryBar(categoryKey: MapCategory, mapList: MapInfo[]) {
    const expanded = this.expandedCategories.has(categoryKey);
    return html`<div class="w-full">
      <button
        type="button"
        aria-expanded=${expanded}
        @click=${() => this.toggleCategory(categoryKey)}
        class="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl border transition-all duration-200 active:scale-[0.99] ${expanded
          ? "bg-malibu-blue/20 border-malibu-blue/50"
          : "bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20"}"
      >
        <span
          class="flex items-center gap-3 text-sm font-bold text-white uppercase tracking-wider"
        >
          <svg
            class="w-3.5 h-3.5 shrink-0 transition-transform duration-200 ${expanded
              ? "rotate-90"
              : ""}"
            viewBox="0 0 12 12"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M4 2l5 4-5 4z" />
          </svg>
          ${translateText(`map_categories.${categoryKey}`)}
        </span>
        <span class="text-xs font-bold text-white/40">${mapList.length}</span>
      </button>
      ${expanded
        ? html`<div class="mt-4">${this.renderMapGrid(mapList)}</div>`
        : null}
    </div>`;
  }

  private renderFeaturedTab() {
    let featuredMapList = featuredMaps;
    const selected = maps.find((m) => m.type === this.selectedMap);
    if (
      !this.useRandomMap &&
      selected !== undefined &&
      !featuredMaps.includes(selected)
    ) {
      featuredMapList = [selected, ...featuredMaps];
    }
    return html`<div class="w-full">
      ${this.renderSectionHeading(translateText("map_categories.featured"))}
      ${this.renderMapGrid(featuredMapList)}
    </div>`;
  }

  private renderAllTab() {
    return html`<div class="space-y-3">
      ${mapCategoryOrder
        .filter(
          (categoryKey) =>
            categoryKey !== "featured" && categoryKey !== "custom",
        )
        .map((categoryKey) =>
          this.renderCategoryBar(categoryKey, mapsInCategory(categoryKey)),
        )}
    </div>`;
  }

  private handleCreateMap = () => {
    // Opens the local Map Maker web app (see SETUP.md) in a new tab.
    // Local-dev convenience; the Map Maker runs separately on port 5000.
    window.open("http://localhost:5000", "_blank", "noopener");
  };

  private renderCreateMapButton() {
    return html`<button
      type="button"
      @click=${this.handleCreateMap}
      class="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-dashed border-malibu-blue/50 bg-malibu-blue/10 text-malibu-blue hover:bg-malibu-blue/20 hover:border-malibu-blue text-sm font-bold uppercase tracking-wider transition-all active:scale-[0.99]"
    >
      <svg
        class="w-4 h-4 shrink-0"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
      >
        <path
          d="M10 3a1 1 0 0 1 1 1v5h5a1 1 0 1 1 0 2h-5v5a1 1 0 1 1-2 0v-5H4a1 1 0 1 1 0-2h5V4a1 1 0 0 1 1-1z"
        />
      </svg>
      ${translateText("map_component.create_map")}
    </button>`;
  }

  private handleDeleteMap = (map: MapInfo) => {
    const name = translateText(map.translationKey);
    if (
      !window.confirm(
        `Delete the custom map "${name}"? It disappears now; its files are removed when you next close/restart the game.`,
      )
    ) {
      return;
    }
    // Hide instantly (no full-page reload). Real deletion is deferred to the
    // next app close (pagehide handler above) so the experience stays smooth.
    this.hiddenMaps = hideCustomMap(map.id);
  };

  private renderCustomMapCard(map: MapInfo) {
    return html`<div class="relative group/del">
      ${this.renderMapCard(map)}
      <button
        type="button"
        title=${translateText("map_component.delete_map")}
        @click=${(e: Event) => {
          e.stopPropagation();
          this.handleDeleteMap(map);
        }}
        class="absolute top-2 left-2 z-20 w-7 h-7 flex items-center justify-center rounded-lg bg-black/60 text-white/80 hover:bg-red-600 hover:text-white opacity-0 group-hover/del:opacity-100 focus:opacity-100 transition-opacity"
      >
        <svg
          class="w-4 h-4"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fill-rule="evenodd"
            d="M9 2a1 1 0 0 0-.894.553L7.382 4H4a1 1 0 0 0 0 2h12a1 1 0 1 0 0-2h-3.382l-.724-1.447A1 1 0 0 0 11 2H9zM6 8a1 1 0 0 1 2 0v6a1 1 0 1 1-2 0V8zm6 0a1 1 0 1 0-2 0v6a1 1 0 1 0 2 0V8z"
            clip-rule="evenodd"
          />
        </svg>
      </button>
    </div>`;
  }

  private renderCustomTab() {
    const customMaps = mapsInCategory("custom").filter(
      (m) => !this.hiddenMaps.has(m.id),
    );
    return html`<div class="w-full space-y-4">
      ${this.renderSectionHeading(translateText("map_categories.custom"))}
      ${this.renderCreateMapButton()}
      ${customMaps.length > 0
        ? html`<div
            class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4"
          >
            ${repeat(
              customMaps,
              (map) => map.id,
              (map) => this.renderCustomMapCard(map),
            )}
          </div>`
        : html`<div
            class="w-full flex flex-col items-center justify-center gap-3 py-12 px-4 text-center rounded-xl border border-dashed border-white/10 bg-black/20"
          >
            <p class="text-sm text-white/50 leading-relaxed max-w-xs">
              ${translateText("map_component.custom_empty")}
            </p>
          </div>`}
    </div>`;
  }

  private renderFavoritesTab() {
    if (this.favorites.length === 0) {
      return html`<div
        class="w-full flex flex-col items-center justify-center gap-3 py-12 px-4 text-center rounded-xl border border-dashed border-white/10 bg-black/20"
      >
        <div class="text-white/30">${starIcon(false, "w-8 h-8")}</div>
        <p class="text-sm text-white/50 leading-relaxed max-w-xs">
          ${translateText("map_component.favorites_empty")}
        </p>
      </div>`;
    }
    const favoriteMaps = this.favorites
      .map((favorite) => maps.find((m) => m.type === favorite))
      .filter((m) => m !== undefined);
    return html`<div class="w-full">
      ${this.renderSectionHeading(translateText("map_categories.favorites"))}
      ${this.renderMapGrid(favoriteMaps)}
    </div>`;
  }

  private renderActiveTab() {
    switch (this.activeTab) {
      case "all":
        return this.renderAllTab();
      case "custom":
        return this.renderCustomTab();
      case "favorites":
        return this.renderFavoritesTab();
      default:
        return this.renderFeaturedTab();
    }
  }

  private renderSearchResults() {
    const results = this.filteredMaps;
    if (results.length === 0) {
      return html`<div
        class="w-full flex flex-col items-center justify-center gap-3 py-12 px-4 text-center rounded-xl border border-dashed border-white/10 bg-black/20"
      >
        <svg
          class="w-8 h-8 text-white/30"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fill-rule="evenodd"
            d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z"
            clip-rule="evenodd"
          />
        </svg>
        <p class="text-sm text-white/50 leading-relaxed max-w-xs">
          ${translateText("map_component.no_results")}
        </p>
      </div>`;
    }
    return html`<div class="w-full">
      ${this.renderSectionHeading(
        `${translateText("map_component.search_results")} (${results.length})`,
      )}
      ${this.renderMapGrid(results)}
    </div>`;
  }

  private renderTabButton(tab: MapTab, label: string) {
    const isActive = this.activeTab === tab;
    return html`<button
      type="button"
      role="tab"
      aria-selected=${isActive}
      class="px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all active:scale-95 ${isActive
        ? "bg-malibu-blue/20 text-white shadow-[var(--shadow-malibu-blue-soft)]"
        : "text-white/60 hover:text-white"}"
      @click=${() => (this.activeTab = tab)}
    >
      ${label}
    </button>`;
  }

  render() {
    const isSearching = this.searchQuery.trim().length > 0;
    return html`
      <div class="space-y-8">
        <div class="w-full">
          ${isSearching
            ? null
            : html`<div
                role="tablist"
                aria-label="${translateText("map.map")}"
                class="grid grid-cols-4 gap-2 rounded-xl border border-white/10 bg-black/20 p-1"
              >
                ${this.renderTabButton(
                  "featured",
                  translateText("map.featured"),
                )}
                ${this.renderTabButton("all", translateText("map.all"))}
                ${this.renderTabButton("custom", translateText("map.custom"))}
                ${this.renderTabButton(
                  "favorites",
                  translateText("map.favorites"),
                )}
              </div>`}
        </div>
        ${isSearching ? this.renderSearchResults() : this.renderActiveTab()}
        <div
          class="w-full ${this.randomMapDivider
            ? "pt-4 border-t border-white/5"
            : ""}"
        >
          ${this.renderSectionHeading(translateText("map_categories.special"))}
          <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            <button
              type="button"
              class="w-full h-full p-3 flex flex-col items-center justify-between rounded-xl border cursor-pointer transition-all duration-200 active:scale-95 gap-3 group ${this
                .useRandomMap
                ? "bg-malibu-blue/20 border-malibu-blue/50 shadow-[var(--shadow-malibu-blue-strong)]"
                : "bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20 hover:-translate-y-1"}"
              @click=${this.handleSelectRandomMap}
            >
              <div
                class="w-full aspect-[2/1] relative overflow-hidden rounded-lg bg-black/20"
              >
                <img
                  src=${randomMap}
                  alt=${translateText("map.random")}
                  draggable="false"
                  @dragstart=${this.preventImageDrag}
                  class="w-full h-full object-cover ${this.useRandomMap
                    ? "opacity-100"
                    : "opacity-80"} group-hover:opacity-100 transition-opacity duration-200"
                />
              </div>
              <div
                class="text-xs font-bold text-white uppercase tracking-wider text-center leading-tight break-words hyphens-auto"
              >
                ${translateText("map.random")}
              </div>
            </button>
          </div>
        </div>
      </div>
    `;
  }
}
