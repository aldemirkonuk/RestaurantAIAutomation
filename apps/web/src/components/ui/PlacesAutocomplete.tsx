import { useCallback, useEffect, useRef, useState } from 'react';
import { MapPin, Loader2 } from 'lucide-react';

export interface PlaceResult {
  streetAddress: string;
  city: string;
  stateProvince: string;
  postalCode: string;
  country: string;
  neighborhood: string;
}

// ── Photon (search phase) ──────────────────────────────────────────────────
interface PhotonFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: {
    osm_id: number;
    osm_type: 'N' | 'W' | 'R';
    country?: string;
    state?: string;
    county?: string;
    city?: string;
    postcode?: string;
    street?: string;
    housenumber?: string;
    name?: string;
    district?: string;
    suburb?: string;
  };
}

// ── Nominatim (resolution phase) ──────────────────────────────────────────
interface NominatimAddress {
  house_number?: string;
  road?: string;
  neighbourhood?: string;
  suburb?: string;
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  county?: string;
  state?: string;
  postcode?: string;
  country?: string;
}

interface PlacesAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onPlaceSelect: (place: PlaceResult) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  country?: string;
}

const searchCache = new Map<string, PhotonFeature[]>();

function photonLabel(f: PhotonFeature): string {
  const p = f.properties;
  return [p.housenumber, p.street].filter(Boolean).join(' ') || p.name || p.city || p.county || '';
}

function parseNominatim(addr: NominatimAddress, fallback: string): PlaceResult {
  return {
    streetAddress: [addr.house_number, addr.road].filter(Boolean).join(' ') || fallback,
    city: addr.city || addr.town || addr.village || addr.municipality || addr.county || '',
    stateProvince: addr.state || '',
    postalCode: addr.postcode || '',
    country: addr.country || '',
    neighborhood: addr.neighbourhood || addr.suburb || '',
  };
}

function parsePhotonFallback(f: PhotonFeature): PlaceResult {
  const p = f.properties;
  return {
    streetAddress: [p.housenumber, p.street].filter(Boolean).join(' ') || p.name || '',
    city: p.city || p.county || '',
    stateProvince: p.state || '',
    postalCode: p.postcode || '',
    country: p.country || '',
    neighborhood: p.district || p.suburb || '',
  };
}

export function PlacesAutocomplete({
  value,
  onChange,
  onPlaceSelect,
  placeholder = 'Start typing an address...',
  className,
  disabled,
  country,
}: PlacesAutocompleteProps) {
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<PhotonFeature[]>([]);
  const [searching, setSearching] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  // track focus so parent value changes never overwrite what the user is typing
  const isFocused = useRef(false);
  const prevCountry = useRef(country);
  const abortSearch = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // sync parent → internal ONLY when the field is not focused
  useEffect(() => {
    if (!isFocused.current) setQuery(value);
  }, [value]);

  // when country changes: clear stale results and re-search immediately
  useEffect(() => {
    if (country === prevCountry.current) return;
    prevCountry.current = country;
    setResults([]);
    setOpen(false);
    if (query.length >= 2) search(query, country);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [country]);

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
        isFocused.current = false;
      }
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, []);

  // ── Search phase: Photon — typo-tolerant, Elasticsearch-backed ───────────
  const search = useCallback((q: string, countryName?: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (abortSearch.current) abortSearch.current.abort();

    if (q.length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }

    timerRef.current = setTimeout(async () => {
      const cacheKey = countryName ? `${q}__${countryName}` : q;
      if (searchCache.has(cacheKey)) {
        setResults(searchCache.get(cacheKey)!);
        setOpen(true);
        return;
      }

      const ctrl = new AbortController();
      abortSearch.current = ctrl;
      setSearching(true);

      try {
        const res = await fetch(
          `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=8&lang=en`,
          { signal: ctrl.signal },
        );
        const data: { features: PhotonFeature[] } = await res.json();
        let features = data.features;

        if (countryName) {
          const scoped = features.filter(
            (f) => f.properties.country?.toLowerCase() === countryName.toLowerCase(),
          );
          // keep scoped results; fall back to global if nothing matched
          if (scoped.length > 0) features = scoped;
        }

        const trimmed = features.slice(0, 5);
        searchCache.set(cacheKey, trimmed);
        setResults(trimmed);
        setOpen(trimmed.length > 0);
        setActiveIndex(-1);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') console.warn('[PlacesAutocomplete] Photon:', err);
      } finally {
        setSearching(false);
      }
    }, 250);
  }, []);

  // ── Resolution phase: single Nominatim lookup by OSM ID ──────────────────
  async function handleSelect(feature: PhotonFeature) {
    const label = photonLabel(feature);
    // fill instantly from Photon data — input stays enabled
    setQuery(label);
    onChange(label);
    setOpen(false);
    setResults([]);
    setResolving(true);

    try {
      const { osm_type, osm_id } = feature.properties;
      const res = await fetch(
        `https://nominatim.openstreetmap.org/lookup?osm_ids=${osm_type}${osm_id}&format=json&addressdetails=1`,
        { headers: { 'Accept-Language': 'en' } },
      );
      const data: Array<{ address: NominatimAddress }> = await res.json();
      const result = data[0]?.address
        ? parseNominatim(data[0].address, label)
        : parsePhotonFallback(feature);

      setQuery(result.streetAddress);
      onChange(result.streetAddress);
      onPlaceSelect(result);
    } catch {
      onPlaceSelect(parsePhotonFallback(feature));
    } finally {
      setResolving(false);
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const q = e.target.value;
    setQuery(q);
    onChange(q);
    search(q, country);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex((i) => Math.min(i + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex((i) => Math.max(i - 1, -1)); }
    else if (e.key === 'Enter' && activeIndex >= 0) { e.preventDefault(); handleSelect(results[activeIndex]); }
    else if (e.key === 'Escape') setOpen(false);
  }

  return (
    <div ref={wrapperRef} className="relative">
      <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-wine-500 pointer-events-none z-10" />

      {/* input — NEVER disabled during resolving; always accepts keystrokes */}
      <input
        value={query}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          isFocused.current = true;
          if (results.length > 0) setOpen(true);
        }}
        onBlur={() => { isFocused.current = false; }}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        className={[
          'flex h-10 w-full border border-input bg-background pl-9 pr-9 py-2 text-sm',
          'placeholder:text-muted-foreground transition-shadow',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wine-500/40 focus-visible:border-wine-400',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        ].filter(Boolean).join(' ')}
      />

      {/* right-side indicator: spinner during search/resolve */}
      {(searching || resolving) && (
        <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-wine-400 animate-spin" />
      )}

      {/* dropdown */}
      {open && results.length > 0 && (
        <div
          role="listbox"
          className={[
            'absolute z-50 w-full mt-1.5 bg-white overflow-hidden',
            'rounded-2xl shadow-[0_8px_30px_rgba(0,0,0,0.10),0_1px_3px_rgba(0,0,0,0.06)]',
            'animate-in fade-in-0 slide-in-from-top-2 duration-150',
          ].join(' ')}
        >
          {/* country filter badge */}
          {country && (
            <div className="px-4 pt-3 pb-1.5 flex items-center gap-1.5">
              <span className="text-[10px] font-semibold tracking-widest uppercase text-gray-400">
                {country}
              </span>
              <span className="flex-1 h-px bg-gray-100" />
            </div>
          )}

          <ul>
            {results.map((f, i) => {
              const p = f.properties;
              const isActive = i === activeIndex;
              const mainLine = photonLabel(f);
              const secondLine = [p.city || p.county, p.state, p.postcode]
                .filter(Boolean).join(', ');

              return (
                <li
                  key={`${p.osm_id}-${i}`}
                  role="option"
                  aria-selected={isActive}
                  onMouseDown={(e) => { e.preventDefault(); handleSelect(f); }}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={[
                    'flex items-center gap-3 px-4 py-3 cursor-pointer select-none',
                    'transition-colors duration-75',
                    i < results.length - 1 ? 'border-b border-gray-50' : '',
                    isActive ? 'bg-wine-50' : 'hover:bg-gray-50',
                  ].join(' ')}
                >
                  <div className={[
                    'flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center',
                    isActive ? 'bg-wine-100' : 'bg-gray-100',
                  ].join(' ')}>
                    <MapPin className={`h-3.5 w-3.5 ${isActive ? 'text-wine-600' : 'text-gray-400'}`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold text-gray-900 truncate leading-tight">
                      {mainLine}
                    </p>
                    {secondLine && (
                      <p className="text-[11px] text-gray-400 truncate mt-0.5 leading-tight">
                        {secondLine}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="px-4 py-2 border-t border-gray-50 flex items-center justify-end gap-1">
            <span className="text-[9px] text-gray-300 font-mono tracking-wide">© OpenStreetMap · Photon · Nominatim</span>
          </div>
        </div>
      )}
    </div>
  );
}
