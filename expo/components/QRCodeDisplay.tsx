import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Rect } from 'react-native-svg';

interface QRModules {
  size: number;
  data: Uint8ClampedArray;
}

interface Props {
  value: string;
  size: number;
  bgColor?: string;
  fgColor?: string;
}

export function QRCodeDisplay({ value, size, bgColor = '#FFFFFF', fgColor = '#000000' }: Props) {
  const qrData = useMemo(() => {
    if (!value) return null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const qrcode = require('qrcode') as {
        create: (text: string, opts: { errorCorrectionLevel: string }) => { modules: QRModules };
      };
      const qr = qrcode.create(value, { errorCorrectionLevel: 'M' });
      const modules = qr.modules;
      const n = modules.size;
      const data = modules.data;
      const cellSize = size / n;
      const rects: Array<{ x: number; y: number }> = [];
      for (let row = 0; row < n; row++) {
        for (let col = 0; col < n; col++) {
          if (data[row * n + col]) {
            rects.push({ x: col * cellSize, y: row * cellSize });
          }
        }
      }
      return { rects, cellSize };
    } catch (e) {
      console.error('[QRCode] Error generating QR code:', e);
      return null;
    }
  }, [value, size]);

  if (!qrData) {
    return <View style={[styles.placeholder, { width: size, height: size, backgroundColor: bgColor }]} />;
  }

  return (
    <Svg width={size} height={size}>
      <Rect width={size} height={size} fill={bgColor} />
      {qrData.rects.map((rect, i) => (
        <Rect
          key={i}
          x={rect.x}
          y={rect.y}
          width={qrData.cellSize + 0.5}
          height={qrData.cellSize + 0.5}
          fill={fgColor}
        />
      ))}
    </Svg>
  );
}

const styles = StyleSheet.create({
  placeholder: {
    borderRadius: 4,
  },
});
