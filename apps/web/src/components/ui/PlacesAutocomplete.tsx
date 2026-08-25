import { importLibrary, setOptions } from '@googlemaps/js-api-loader';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Building2, Loader2, MapPin, Search } from 'lucide-react';

export interface PlaceResult {
  streetAddress: string;
  city: string;
  stateProvince: string;
  postalCode: string;
  country: string;
  neighborhood: string;
  /**
   * Coordinates of the selected place.
   *
   * Google resolves these as part of the same fetchFields call that already
   * returns the address components, so capturing them costs no extra request
   * and no separate geocoding service. Null when Places declines to supply a
   * location for the chosen prediction — callers must treat "no coordinates"
   * as a real state rather than defaulting to 0,0, which renders as a pin in
   * the Gulf of Guinea.
   */
  latitude: number | null;
  longitude: number | null;
}

interface SuggestionRow {
  prediction: google.maps.places.PlacePrediction;
  main: string;
  secondary: string;
  types: string[];
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

// country display name → ISO 3166-1 alpha-2
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

const MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

// ── singleton: load the new Places library once ───────────────────────────────
type NewPlacesLib = typeof google.maps.places;
let placesLib: NewPlacesLib | null = null;
let loadPromise: Promise<void> | null = null;

async function ensurePlaces(): Promise<NewPlacesLib> {
  if (!MAPS_API_KEY) throw new Error('VITE_GOOGLE_MAPS_API_KEY not set');
  if (placesLib) return placesLib;
  if (!loadPromise) {
    setOptions({ key: MAPS_API_KEY, language: 'en' });
    loadPromise = (importLibrary('places') as Promise<NewPlacesLib>).then((lib) => {
      placesLib = lib;
    });
  }
  await loadPromise;
  return placesLib!;
}

function parseAddressComponents(
  components: google.maps.places.AddressComponent[],
): PlaceResult {
  const get = (type: string) =>
    components.find((c) => c.types.includes(type))?.longText ?? '';

  const streetNumber = get('street_number');
  const route = get('route');

  return {
    // Coordinates are not in addressComponents — they come from place.location
    // and are attached by the caller after fetchFields resolves. Initialised
    // null rather than omitted so the type stays honest about what this
    // function can and cannot know.
    latitude: null,
    longitude: null,
    streetAddress: [streetNumber, route].filter(Boolean).join(' '),
    city:
      get('locality') ||
      get('sublocality') ||
      get('administrative_area_level_3') ||
      get('postal_town') ||
      '',
    stateProvince: get('administrative_area_level_1'),
    postalCode: get('postal_code'),
    country: get('country'),
    neighborhood: get('neighborhood') || get('sublocality_level_1') || '',
  };
}

function isEstablishment(types: string[]) {
  return types.some((t) =>
    ['establishment', 'restaurant', 'food', 'lodging', 'store'].includes(t),
  );
}

// ── component ────────────────────────────────────────────────────────────────
export function PlacesAutocomplete({
  value,
  onChange,
  onPlaceSelect,
  placeholder = 'Start typing an address…',
  className,
  disabled,
  country,
}: PlacesAutocompleteProps) {
  const [query, setQuery] = useState(value);
  const [rows, setRows] = useState<SuggestionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [apiError, setApiError] = useState<string | null>(null);

  const isFocused = useRef(false);
  const prevCountry = useRef(country);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isFocused.current) setQuery(value);
  }, [value]);

  useEffect(() => {
    if (country === prevCountry.current) return;
    prevCountry.current = country;
    setRows([]);
    setOpen(false);
    if (isFocused.current && query.trim().length >= 2) search(query, country);
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

  const search = useCallback((q: string, countryName?: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);

    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setRows([]);
      setOpen(false);
      return;
    }

    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        setApiError(null);
        const lib = await ensurePlaces();
        const iso = countryName ? COUNTRY_ISO[countryName] : undefined;

        const { suggestions } = await lib.AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: trimmed,
          // 'address' is a legacy type — not valid in the new Places API.
          // Country filter already scopes results; omitting primaryTypes gives street + premise results.
          ...(iso ? { includedRegionCodes: [iso] } : {}),
        });

        const next: SuggestionRow[] = suggestions
          .slice(0, 5)
          .filter((s) => s.placePrediction != null && s.placePrediction.mainText != null)
          .map((s) => ({
            prediction: s.placePrediction!,
            main: s.placePrediction!.mainText!.text,
            secondary: s.placePrediction!.secondaryText?.text ?? '',
            types: s.placePrediction!.types,
          }));

        setRows(next);
        setOpen(next.length > 0);
        setActiveIndex(-1);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[PlacesAutocomplete]', msg);
        // Surface actionable errors — billing / API-not-enabled are the most common
        if (msg.includes('BillingNotEnabled') || msg.includes('billing')) {
          setApiError('Google Maps billing not enabled — enable it in Google Cloud Console');
        } else if (msg.includes('ApiNotActivated') || msg.includes('not activated') || msg.includes('places')) {
          setApiError('Places API (New) not enabled in Google Cloud Console');
        } else if (msg.includes('RefererNotAllowed') || msg.includes('referer')) {
          setApiError('API key not allowed for this domain — check Google Cloud key restrictions');
        } else if (msg.includes('VITE_GOOGLE_MAPS_API_KEY')) {
          setApiError('VITE_GOOGLE_MAPS_API_KEY is not set in this environment');
        } else {
          setApiError(`Maps error: ${msg.slice(0, 80)}`);
        }
      } finally {
        setLoading(false);
      }
    }, 220);
  }, []);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const q = e.target.value;
    setQuery(q);
    onChange(q);
    search(q, country);
  }

  async function handleSelect(row: SuggestionRow) {
    setQuery(row.main);
    onChange(row.main);
    setOpen(false);
    setRows([]);

    try {
      const place = row.prediction.toPlace();
      await place.fetchFields({
        fields: ['addressComponents', 'formattedAddress', 'location'],
      });

      if (!place.addressComponents) return;

      const result = parseAddressComponents(place.addressComponents);
      if (!result.streetAddress && place.formattedAddress) {
        result.streetAddress = place.formattedAddress.split(',')[0].trim();
      }
      result.latitude = place.location?.lat() ?? null;
      result.longitude = place.location?.lng() ?? null;
      onPlaceSelect(result);
    } catch (err) {
      console.warn('[PlacesAutocomplete] getDetails failed', err);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, rows.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, -1));
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      handleSelect(rows[activeIndex]);
    } else if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
    }
  }

  if (!MAPS_API_KEY) {
    return (
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        className={[
          'flex h-10 w-full rounded-lg border border-input bg-background',
          'px-3 py-2 text-sm text-gray-900',
          'placeholder:text-gray-400',
          'transition-[border-color,box-shadow] duration-150',
          'focus-visible:outline-none focus-visible:ring-2',
          'focus-visible:ring-wine-500/25 focus-visible:border-wine-400',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
      />
    );
  }

  return (
    <div ref={wrapperRef} className="relative">
      {apiError && (
        <div className="flex items-start gap-1.5 mb-1.5 text-[11px] text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1.5">
          <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
          <span>{apiError}</span>
        </div>
      )}
      <div className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none z-10" />

      <input
        ref={inputRef}
        value={query}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          isFocused.current = true;
          if (rows.length > 0) setOpen(true);
        }}
        onBlur={() => {
          isFocused.current = false;
        }}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-autocomplete="list"
        className={[
          'flex h-10 w-full rounded-lg border border-input bg-background',
          'pl-9 pr-9 py-2 text-sm text-gray-900',
          'placeholder:text-gray-400',
          'transition-[border-color,box-shadow] duration-150',
          'focus-visible:outline-none focus-visible:ring-2',
          'focus-visible:ring-wine-500/25 focus-visible:border-wine-400',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
      />

      {loading && (
        <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-wine-400 animate-spin" />
      )}

      {open && rows.length > 0 && (
        <div
          role="listbox"
          className={[
            'absolute z-50 w-full mt-2 overflow-hidden',
            'bg-white border border-gray-100',
            'rounded-2xl shadow-[0_8px_32px_-4px_rgba(0,0,0,0.12),0_2px_8px_-2px_rgba(0,0,0,0.06)]',
            'animate-in fade-in-0 slide-in-from-top-2 duration-150',
          ].join(' ')}
        >
          {country && (
            <div className="flex items-center gap-2.5 px-4 pt-3 pb-2">
              <MapPin className="h-3 w-3 text-wine-400 flex-shrink-0" />
              <span className="text-[10px] font-semibold tracking-[0.08em] uppercase text-gray-400">
                {country}
              </span>
              <span className="flex-1 h-px bg-gray-100" />
            </div>
          )}

          <ul className="py-1">
            {rows.map((row, i) => {
              const isActive = i === activeIndex;
              const isPlace = isEstablishment(row.types);
              return (
                <li
                  key={row.prediction.placeId}
                  role="option"
                  aria-selected={isActive}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleSelect(row);
                  }}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={[
                    'flex items-center gap-3 px-3 mx-2 py-2.5 cursor-pointer select-none',
                    'rounded-xl transition-all duration-75',
                    isActive
                      ? 'bg-wine-50 shadow-[inset_0_0_0_1px_rgba(127,29,29,0.06)]'
                      : 'hover:bg-gray-50',
                  ].join(' ')}
                >
                  <div
                    className={[
                      'flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center transition-colors duration-75',
                      isActive ? 'bg-wine-100' : 'bg-gray-100',
                    ].join(' ')}
                  >
                    {isPlace ? (
                      <Building2
                        className={`h-3.5 w-3.5 ${isActive ? 'text-wine-600' : 'text-gray-400'}`}
                      />
                    ) : (
                      <MapPin
                        className={`h-3.5 w-3.5 ${isActive ? 'text-wine-600' : 'text-gray-400'}`}
                      />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p
                      className={[
                        'text-[13px] font-medium leading-tight truncate',
                        isActive ? 'text-wine-900' : 'text-gray-800',
                      ].join(' ')}
                    >
                      {row.main}
                    </p>
                    {row.secondary && (
                      <p className="text-[11px] text-gray-400 truncate mt-0.5 leading-tight">
                        {row.secondary}
                      </p>
                    )}
                  </div>

                  {isActive && (
                    <svg
                      className="flex-shrink-0 h-3 w-3 text-wine-400"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2.5}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="flex items-center justify-end gap-1.5 px-4 py-2 border-t border-gray-50">
            <span className="text-[9px] text-gray-300 tracking-wide">powered by</span>
            <svg viewBox="0 0 54 18" className="h-2.5 opacity-30" aria-label="Google">
              <text y="14" fontSize="14" fontFamily="Arial, sans-serif" fontWeight="700" fill="#4285F4">G</text>
              <text x="10" y="14" fontSize="14" fontFamily="Arial, sans-serif" fontWeight="700" fill="#EA4335">o</text>
              <text x="19" y="14" fontSize="14" fontFamily="Arial, sans-serif" fontWeight="700" fill="#FBBC05">o</text>
              <text x="28" y="14" fontSize="14" fontFamily="Arial, sans-serif" fontWeight="700" fill="#4285F4">g</text>
              <text x="37" y="14" fontSize="14" fontFamily="Arial, sans-serif" fontWeight="700" fill="#34A853">l</text>
              <text x="43" y="14" fontSize="14" fontFamily="Arial, sans-serif" fontWeight="700" fill="#EA4335">e</text>
            </svg>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
