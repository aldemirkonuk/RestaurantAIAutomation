import React, { useEffect, useMemo } from "react";
import { View } from "react-native";
import {
  Canvas,
  LinearGradient,
  Path,
  Skia,
  vec,
} from "@shopify/react-native-skia";
import { useSharedValue, withTiming } from "react-native-reanimated";
import { Easing } from "react-native-reanimated";
import { AppText } from "@/components/ui/AppText";
import { color, space } from "@/design/tokens";

interface SparklineProps {
  /** One value per day, oldest first. */
  values: number[];
  width: number;
  height?: number;
}

/** Skia-drawn 14-day depletion line: draws itself in once, then sits still. */
export function Sparkline({ values, width, height = 56 }: SparklineProps) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(1, {
      duration: 700,
      easing: Easing.bezier(0.2, 0, 0, 1),
    });
  }, [progress]);

  const { line, fill } = useMemo(() => {
    const max = Math.max(...values, 1);
    const stepX = values.length > 1 ? width / (values.length - 1) : width;
    const pts = values.map((v, i) => ({
      x: i * stepX,
      y: height - 6 - (v / max) * (height - 12),
    }));

    const linePath = Skia.Path.Make();
    const fillPath = Skia.Path.Make();
    pts.forEach((p, i) => {
      if (i === 0) {
        linePath.moveTo(p.x, p.y);
        fillPath.moveTo(p.x, height);
        fillPath.lineTo(p.x, p.y);
      } else {
        const prev = pts[i - 1];
        const cx = (prev.x + p.x) / 2;
        linePath.cubicTo(cx, prev.y, cx, p.y, p.x, p.y);
        fillPath.cubicTo(cx, prev.y, cx, p.y, p.x, p.y);
      }
    });
    if (pts.length) {
      fillPath.lineTo(pts[pts.length - 1].x, height);
      fillPath.close();
    }
    return { line: linePath, fill: fillPath };
  }, [values, width, height]);

  if (!values.length || values.every((v) => v === 0)) {
    return (
      <View style={{ height, justifyContent: "center" }}>
        <AppText variant="caption" tone="tertiary">
          No pours or sales in the last two weeks
        </AppText>
      </View>
    );
  }

  return (
    <Canvas style={{ width, height }}>
      <Path path={fill} style="fill">
        <LinearGradient
          start={vec(0, 0)}
          end={vec(0, height)}
          colors={[color.wineTintStrong, "#FDF2F400"]}
        />
      </Path>
      <Path
        path={line}
        style="stroke"
        strokeWidth={2}
        strokeCap="round"
        color={color.wine}
        start={0}
        end={progress}
      />
    </Canvas>
  );
}

export function SparklineBlock({
  values,
  width,
}: {
  values: number[];
  width: number;
}) {
  return (
    <View style={{ gap: space.xs }}>
      <AppText variant="caption" tone="tertiary">
        Last 14 days
      </AppText>
      <Sparkline values={values} width={width} />
    </View>
  );
}
