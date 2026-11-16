/**
 * Plants the forest off the main thread (~300 ms of dart throwing and noise), while the models
 * download. The shade map comes back as a transferred buffer.
 */
import { plantForest, type Quality } from './layout';

self.onmessage = (e: MessageEvent<Quality>) => {
  const { shade, ...rest } = plantForest(e.data);
  const raw = { rect: shade.rect, res: shade.res, data: shade.data };
  (self as unknown as Worker).postMessage({ ...rest, shade: raw }, [shade.data.buffer]);
};
