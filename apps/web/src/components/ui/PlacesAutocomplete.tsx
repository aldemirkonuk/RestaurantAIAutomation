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

interface NominatimResult {
  place_id: number;
  display_name: string;
  address: {
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
  };
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

const COUNTRY_ISO: Record<string, string> = {
  'Afghanistan':'af','Albania':'al','Algeria':'dz','Argentina':'ar','Armenia':'am',
  'Australia':'au','Austria':'at','Azerbaijan':'az','Bahrain':'bh','Bangladesh':'bd',
  'Belarus':'by','Belgium':'be','Bolivia':'bo','Bosnia and Herzegovina':'ba',
  'Brazil':'br','Bulgaria':'bg','Cambodia':'kh','Canada':'ca','Chile':'cl',
  'China':'cn','Colombia':'co','Croatia':'hr','Cuba':'cu','Cyprus':'cy',
  'Czech Republic':'cz','Denmark':'dk','Dominican Republic':'do','Ecuador':'ec',
  'Egypt':'eg','Estonia':'ee','Ethiopia':'et','Finland':'fi','France':'fr',
  'Georgia':'ge','Germany':'de','Ghana':'gh','Greece':'gr','Guatemala':'gt',
  'Honduras':'hn','Hungary':'hu','Iceland':'is','India':'in','Indonesia':'id',
  'Iran':'ir','Iraq':'iq','Ireland':'ie','Israel':'il','Italy':'it',
  'Jamaica':'jm','Japan':'jp','Jordan':'jo','Kazakhstan':'kz','Kenya':'ke',
  'Kuwait':'kw','Latvia':'lv','Lebanon':'lb','Libya':'ly','Lithuania':'lt',
  'Luxembourg':'lu','Malaysia':'my','Malta':'mt','Mexico':'mx','Moldova':'md',
  'Morocco':'ma','Myanmar':'mm','Nepal':'np','Netherlands':'nl','New Zealand':'nz',
  'Nicaragua':'ni','Nigeria':'ng','North Macedonia':'mk','Norway':'no','Oman':'om',
  'Pakistan':'pk','Panama':'pa','Paraguay':'py','Peru':'pe','Philippines':'ph',
  'Poland':'pl','Portugal':'pt','Qatar':'qa','Romania':'ro','Russia':'ru',
  'Saudi Arabia':'sa','Senegal':'sn','Serbia':'rs','Singapore':'sg','Slovakia':'sk',
  'Slovenia':'si','South Africa':'za','South Korea':'kr','Spain':'es','Sri Lanka':'lk',
  'Sudan':'sd','Sweden':'se','Switzerland':'ch','Syria':'sy','Taiwan':'tw',
  'Tanzania':'tz','Thailand':'th','Tunisia':'tn','Turkey':'tr','Uganda':'ug',
  'Ukraine':'ua','United Arab Emirates':'ae','United Kingdom':'gb',
  'United States':'us','Uruguay':'uy','Uzbekistan':'uz','Venezuela':'ve',
  'Vietnam':'vn','Yemen':'ye','Zimbabwe':'zw',
};

const cache = new Map<string, NominatimResult[]>();

function parseResult(r: NominatimResult): PlaceResult {
  const a = r.address;
  return {
    streetAddress: [a.house_number, a.road].filter(Boolean).join(' ') || r.display_name,
    city: a.city || a.town || a.village || a.municipality || a.county || '',
    stateProvince: a.state || '',
    postalCode: a.postcode || '',
    country: a.country || '',
    neighborhood: a.neighbourhood || a.suburb || '',
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
  const [results, setResults] = useState<NominatimResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const search = useCallback((q: string, countryName?: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (abortRef.current) abortRef.current.abort();

    if (q.length < 3) {
      setResults([]);
      setOpen(false);
      return;
    }

    timerRef.current = setTimeout(async () => {
      const iso = countryName ? COUNTRY_ISO[countryName] : undefined;
      const cacheKey = iso ? `${q}__${iso}` : q;

      if (cache.has(cacheKey)) {
        setResults(cache.get(cacheKey)!);
        setOpen(true);
        return;
      }

      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setLoading(true);

      try {
        const countryParam = iso ? `&countrycodes=${iso}` : '';
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&addressdetails=1&limit=5${countryParam}`;
        const res = await fetch(url, {
          signal: ctrl.signal,
          headers: { 'Accept-Language': 'en' },
        });
        const data: NominatimResult[] = await res.json();
        cache.set(cacheKey, data);
        setResults(data);
        setOpen(data.length > 0);
        setActiveIndex(-1);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') console.warn('[PlacesAutocomplete]', err);
      } finally {
        setLoading(false);
      }
    }, 500);
  }, []);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const q = e.target.value;
    setQuery(q);
    onChange(q);
    search(q, country);
  }

  function handleSelect(r: NominatimResult) {
    const parsed = parseResult(r);
    setQuery(parsed.streetAddress);
    onChange(parsed.streetAddress);
    onPlaceSelect(parsed);
    setOpen(false);
    setResults([]);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, -1));
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      handleSelect(results[activeIndex]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div ref={wrapperRef} className="relative">
      <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none z-10" />
      <input
        value={query}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => results.length > 0 && setOpen(true)}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        className={[
          'flex h-10 w-full border border-input bg-background pl-9 pr-9 py-2 text-sm',
          'placeholder:text-muted-foreground',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'rounded-none',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
      />
      {loading && (
        <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground animate-spin" />
      )}

      {open && results.length > 0 && (
        <ul
          role="listbox"
          className="absolute z-50 w-full mt-px bg-zinc-950 border border-zinc-700 shadow-[4px_4px_0_0_rgba(0,0,0,0.6)] max-h-64 overflow-y-auto"
        >
          {results.map((r, i) => {
            const parsed = parseResult(r);
            const isActive = i === activeIndex;
            return (
              <li
                key={r.place_id}
                role="option"
                aria-selected={isActive}
                onMouseDown={(e) => { e.preventDefault(); handleSelect(r); }}
                onMouseEnter={() => setActiveIndex(i)}
                className={[
                  'flex items-start gap-2.5 px-3 py-2.5 cursor-pointer select-none',
                  'border-b border-zinc-800/60 last:border-0',
                  isActive ? 'bg-zinc-800' : 'hover:bg-zinc-900',
                ].join(' ')}
              >
                <MapPin className="h-3 w-3 text-zinc-500 mt-1 shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-medium text-white truncate leading-snug">
                    {[parsed.streetAddress, parsed.city].filter(Boolean).join(', ')}
                  </p>
                  <p className="text-[10px] text-zinc-500 truncate leading-snug mt-0.5 tracking-wide">
                    {[parsed.stateProvince, parsed.postalCode, parsed.country].filter(Boolean).join(' · ')}
                  </p>
                </div>
              </li>
            );
          })}
          <li className="px-3 py-1 text-[9px] text-zinc-700 font-mono tracking-widest uppercase">
            © OpenStreetMap contributors
          </li>
        </ul>
      )}
    </div>
  );
}
