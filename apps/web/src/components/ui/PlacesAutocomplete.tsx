import { useEffect, useRef, useState } from 'react';
import { Loader } from '@googlemaps/js-api-loader';
import { MapPin, Loader2 } from 'lucide-react';
import { Input } from './input';

export interface PlaceResult {
  streetAddress: string;
  city: string;
  stateProvince: string;
  postalCode: string;
  country: string;
  neighborhood: string;
}

interface PlacesAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onPlaceSelect: (place: PlaceResult) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

let loaderInstance: Loader | null = null;
let placesLoaded = false;

function getLoader(): Loader {
  if (!loaderInstance) {
    loaderInstance = new Loader({
      apiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '',
      version: 'weekly',
      libraries: ['places'],
    });
  }
  return loaderInstance;
}

export function PlacesAutocomplete({
  value,
  onChange,
  onPlaceSelect,
  placeholder = 'Start typing an address...',
  className,
  disabled,
}: PlacesAutocompleteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const [loading, setLoading] = useState(false);
  const [apiKeyMissing, setApiKeyMissing] = useState(false);

  useEffect(() => {
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      setApiKeyMissing(true);
      return;
    }

    let cancelled = false;

    async function initAutocomplete() {
      if (!inputRef.current) return;
      setLoading(true);
      try {
        if (!placesLoaded) {
          await getLoader().load();
          placesLoaded = true;
        }

        if (cancelled || !inputRef.current) return;

        const autocomplete = new google.maps.places.Autocomplete(inputRef.current, {
          types: ['address'],
          fields: ['address_components', 'formatted_address'],
        });

        autocompleteRef.current = autocomplete;

        autocomplete.addListener('place_changed', () => {
          const place = autocomplete.getPlace();
          if (!place.address_components) return;

          const get = (type: string, short = false) => {
            const comp = place.address_components!.find((c) => c.types.includes(type));
            return comp ? (short ? comp.short_name : comp.long_name) : '';
          };

          // Build street address from number + route
          const streetNumber = get('street_number');
          const route = get('route');
          const streetAddress = [streetNumber, route].filter(Boolean).join(' ');

          const result: PlaceResult = {
            streetAddress: streetAddress || place.formatted_address || '',
            city:
              get('locality') ||
              get('sublocality_level_1') ||
              get('postal_town') ||
              get('administrative_area_level_3') ||
              get('administrative_area_level_2'),
            stateProvince: get('administrative_area_level_1', true),
            postalCode: get('postal_code'),
            country: get('country', true),
            neighborhood:
              get('neighborhood') ||
              get('sublocality_level_1') ||
              get('sublocality'),
          };

          onChange(result.streetAddress);
          onPlaceSelect(result);
        });
      } catch {
        // Places API unavailable — fall back to plain input silently
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    initAutocomplete();
    return () => {
      cancelled = true;
      if (autocompleteRef.current) {
        google.maps.event.clearInstanceListeners(autocompleteRef.current);
        autocompleteRef.current = null;
      }
    };
  }, []);

  // Sync controlled value to the real input when the parent changes it programmatically
  useEffect(() => {
    if (inputRef.current && inputRef.current.value !== value) {
      inputRef.current.value = value;
    }
  }, [value]);

  if (apiKeyMissing) {
    return (
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={className}
        disabled={disabled}
      />
    );
  }

  return (
    <div className="relative">
      <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none z-10" />
      <input
        ref={inputRef}
        defaultValue={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className={[
          'flex h-10 w-full rounded-md border border-input bg-background pl-9 pr-9 py-2 text-sm ring-offset-background',
          'file:border-0 file:bg-transparent file:text-sm file:font-medium',
          'placeholder:text-muted-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
      />
      {loading && (
        <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground animate-spin" />
      )}
    </div>
  );
}
