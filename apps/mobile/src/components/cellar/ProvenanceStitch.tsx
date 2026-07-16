import React, { useEffect, useMemo } from "react";
import { View } from "react-native";
import { Canvas, Path, Skia } from "@shopify/react-native-skia";
import { Easing, useSharedValue, withDelay, withTiming } from "react-native-reanimated";
import { AppText } from "@/components/ui/AppText";
import { color, space } from "@/design/tokens";

/** Wines whose stitch already drew this session — it never repeats. */
const stitched = new Set<string>();

interface ProvenanceStitchProps {
  wineId: string;
  facts: Array<{ label: string; value: string }>;
  width: number;
}

/**
 * Provenance Stitch — on first open of a wine, a hairline draws itself
 * through the provenance facts (vintage, region, vendor cost), tying the
 * bottle to its story. First view only; afterwards the line just is.
 */
export function ProvenanceStitch({ wineId, facts, width }: ProvenanceStitchProps) {
  const firstView = !stitched.has(wineId);
  const progress = useSharedValue(firstView ? 0 : 1);

  useEffect(() => {
    if (firstView) {
      stitched.add(wineId);
      progress.value = withDelay(
        250,
        withTiming(1, { duration: 900, easing: Easing.bezier(0.4, 0, 0.2, 1) }),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wineId]);

  const path = useMemo(() => {
    const p = Skia.Path.Make();
    // A gentle running-stitch wave under the facts row.
    const y = 5;
    const amp = 2.5;
    p.moveTo(0, y);
    const segments = 8;
    for (let i = 1; i <= segments; i++) {
      const x = (width / segments) * i;
      const prevX = (width / segments) * (i - 1);
      const cy = y + (i % 2 === 0 ? amp : -amp);
      p.quadTo((prevX + x) / 2, cy, x, y);
    }
    return p;
  }, [width]);

  if (!facts.length) return null;

  return (
    <View style={{ gap: space.sm }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: space.xl, rowGap: space.sm }}>
        {facts.map((f) => (
          <View key={f.label}>
            <AppText variant="caption" tone="tertiary">
              {f.label}
            </AppText>
            <AppText variant="bodyMedium">{f.value}</AppText>
          </View>
        ))}
      </View>
      <Canvas style={{ width, height: 10 }}>
        <Path
          path={path}
          style="stroke"
          strokeWidth={1}
          color={color.wineTintStrong}
          start={0}
          end={progress}
        />
      </Canvas>
    </View>
  );
}
