import type { WaveformData } from '@vep/core';
import { useEffect, useState } from 'react';
import { api } from '../../api/client';

const waveforms = new Map<string, Promise<WaveformData>>();
const sprites = new Map<string, HTMLImageElement>();

export function useWaveform(url: string | null): WaveformData | null {
  const [data, setData] = useState<WaveformData | null>(null);
  useEffect(() => {
    if (!url) {
      setData(null);
      return;
    }
    let promise = waveforms.get(url);
    if (!promise) {
      promise = api.waveform(url);
      waveforms.set(url, promise);
      promise.catch(() => waveforms.delete(url));
    }
    let cancelled = false;
    promise.then((d) => !cancelled && setData(d)).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [url]);
  return data;
}

export function useSprite(url: string | null): HTMLImageElement | null {
  const [image, setImage] = useState<HTMLImageElement | null>(() => {
    const cached = url ? sprites.get(url) : undefined;
    return cached?.complete ? cached : null;
  });
  useEffect(() => {
    if (!url) {
      setImage(null);
      return;
    }
    let img = sprites.get(url);
    if (!img) {
      img = new Image();
      img.src = url;
      sprites.set(url, img);
    }
    if (img.complete && img.naturalWidth > 0) {
      setImage(img);
      return;
    }
    const target = img;
    const onLoad = () => setImage(target);
    target.addEventListener('load', onLoad);
    return () => target.removeEventListener('load', onLoad);
  }, [url]);
  return image;
}
